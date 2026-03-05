/**
 * Chartbrew Backend Performance & Rate Limit Test
 *
 * Tests three things in one run:
 *   1. Rate limiting  — verifies 429s are returned when limits are exceeded
 *   2. Performance    — measures latency and throughput under realistic load
 *   3. Correctness    — checks every response has an expected status code
 *
 * Prerequisites:
 *   - Chartbrew server running at http://[::1]:4019  (CB_API_PORT in .env)
 *   - k6 installed:  brew install k6
 *
 * Required env vars:
 *   CB_EMAIL      your Chartbrew account email
 *   CB_PASSWORD   your Chartbrew account password
 *
 * Optional env vars (defaults shown):
 *   BASE_URL        http://[::1]:4019
 *   CB_TEAM_ID      1
 *   CB_PROJECT_ID   1
 *   CB_CHART_ID     1
 *   CB_BREW_NAME    (public dashboard slug — skips that scenario if omitted)
 *
 * Run:
 *   BASE_URL=http://[::1]:4019 \
 *   CB_EMAIL=admin@example.com \
 *   CB_PASSWORD=your-password \
 *   CB_TEAM_ID=1 \
 *   CB_PROJECT_ID=1 \
 *   CB_CHART_ID=1 \
 *   k6 run k6-script.sample.ts
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

// ── Custom metrics ──────────────────────────────────────────────────────────────
// chart_filter_latency tracks the checkFilterAccess path (our Promise.all optimization).
// Keeping it separate from the http_req_duration aggregate makes it easy to
// compare before/after optimization runs.
const filterLatency  = new Trend("chart_filter_latency",  true);
const filterErrors   = new Rate("chart_filter_errors");
const queryErrors    = new Rate("chart_query_errors");
const rateLimitHits  = new Counter("rate_limit_429_count"); // 429s are expected in the rate limit scenario

// ── Load configuration ──────────────────────────────────────────────────────────
export const options = {
  scenarios: {

    // ── Phase 1 (0 s): Rate limit verification ──────────────────────────────
    // Sends requests to endpoints that have strict rate limits and confirms
    // the server returns 429 once the threshold is crossed.
    //
    // POST /ai/orchestrate — limit: 3 per minute, rate limiter fires BEFORE
    // verifyToken so unauthenticated requests still count toward the quota.
    // 4 rapid-fire iterations with 1 VU = first 3 get 401, 4th gets 429.
    rate_limit_ai: {
      executor:    "shared-iterations",
      vus:         1,
      iterations:  4,
      maxDuration: "30s",
      exec:        "rateLimitAiScenario",
      startTime:   "0s",
    },

    // POST /user/password/reset — limit: 3 per 15 minutes.
    // 4 rapid-fire iterations = first 3 get 200, 4th gets 429.
    rate_limit_password_reset: {
      executor:    "shared-iterations",
      vus:         1,
      iterations:  4,
      maxDuration: "30s",
      exec:        "rateLimitPasswordResetScenario",
      startTime:   "0s",
    },

    // ── Phase 2 (35 s): Performance load ────────────────────────────────────
    // Starts after the rate limit scenarios finish so their 429s do not
    // inflate the overall http_req_failed metric.

    // Primary perf scenario — exercises the optimized checkFilterAccess path.
    // Peak kept at 20 VUs for local dev — raise to 50+ against a staging server.
    chart_filter_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 }, // warm-up ramp
        { duration: "1m",  target: 20 }, // sustained peak
        { duration: "30s", target: 0  }, // ramp down
      ],
      exec:      "chartFilterScenario",
      startTime: "35s",
    },

    // Public dashboard GETs — unauthenticated, high-frequency in production.
    dashboard_reads: {
      executor:  "constant-vus",
      vus:       5,
      duration:  "2m",
      exec:      "publicDashboardScenario",
      startTime: "35s",
    },

    // Authenticated reads: teams → projects → charts.
    // Simulates a user opening the Chartbrew app.
    team_project_reads: {
      executor:  "constant-vus",
      vus:       5,
      duration:  "2m",
      exec:      "teamProjectReadScenario",
      startTime: "35s",
    },

    // Chart data queries — hits real data sources, kept at low concurrency.
    chart_queries: {
      executor:  "constant-vus",
      vus:       3,
      duration:  "1m30s",
      exec:      "chartQueryScenario",
      startTime: "1m5s",
    },
  },

  thresholds: {
    // Rate limiting must be enforced — we must see at least 1 blocked request.
    rate_limit_429_count: ["count>0"],

    // Filter path (optimized) — p95 under 500 ms.
    chart_filter_latency: ["p(95)<500"],
    // Less than 1 % of filter requests may return unexpected errors.
    chart_filter_errors:  ["rate<0.01"],

    // Overall 5xx rate across performance scenarios only (rate limit scenarios
    // intentionally return 401/429 which would inflate http_req_failed).
    "http_req_failed{scenario:chart_filter_load}":  ["rate<0.01"],
    "http_req_failed{scenario:team_project_reads}": ["rate<0.01"],
    "http_req_failed{scenario:chart_queries}":      ["rate<1.00"], // tolerated until a real data source is wired up

    // Per-scenario response time thresholds.
    "http_req_duration{scenario:chart_filter_load}":  ["p(99)<1000"],
    "http_req_duration{scenario:dashboard_reads}":    ["p(95)<1000"],
    "http_req_duration{scenario:team_project_reads}": ["p(95)<500"],
    "http_req_duration{scenario:chart_queries}":      ["p(95)<2000"],
  },
};

// ── Setup — runs once before all VUs start ──────────────────────────────────────
// Authenticates with the server and distributes the token to every VU.
// Doing this in setup() ensures the login endpoint is only called once,
// which is critical given its 5-per-15-min rate limit.
export function setup() {
  const baseUrl  = __ENV.BASE_URL    || "http://[::1]:4019";
  const email    = __ENV.CB_EMAIL    || "hminstatwat@gmail.com";
  const password = __ENV.CB_PASSWORD || "Theguy1!";

  const loginRes = http.post(
    `${baseUrl}/user/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  const ok = check(loginRes, {
    "setup > login: 200":      (r) => r.status === 200,
    "setup > login: has token": (r) => !!(r.json() as Record<string, string>)?.token,
  });

  if (!ok) {
    throw new Error(
      `Login failed (HTTP ${loginRes.status}). ` +
      "Check CB_EMAIL and CB_PASSWORD are correct and the server is running at BASE_URL.",
    );
  }

  const body = loginRes.json() as Record<string, string>;

  return {
    baseUrl,
    token:     body.token,
    teamId:    __ENV.CB_TEAM_ID    || "1",
    projectId: __ENV.CB_PROJECT_ID || "1",
    chartId:   __ENV.CB_CHART_ID   || "18",
    brewName:  __ENV.CB_BREW_NAME  || "",
  };
}

type Data = ReturnType<typeof setup>;

// ── Rate limit scenarios ────────────────────────────────────────────────────────

// Sends 4 unauthenticated requests to /ai/orchestrate (limit: 3/min).
// Requests 1–3 should return 401. Request 4 should return 429.
export function rateLimitAiScenario(data: Data): void {
  const res = http.post(
    `${data.baseUrl}/ai/orchestrate`,
    JSON.stringify({ teamId: 1, question: "perf-test", conversationHistory: [] }),
    {
      headers: { "Content-Type": "application/json" },
      tags:    { name: "rate_limit_ai" },
    },
  );

  if (res.status === 429) rateLimitHits.add(1);

  check(res, {
    "rate limit AI: no 5xx":            (r) => r.status < 500,
    "rate limit AI: 401 or 429 only":   (r) => r.status === 401 || r.status === 429,
  });
  // No sleep — fire requests as fast as possible to hit the rate limit.
}

// Sends 4 requests to /user/password/reset (limit: 3/15min).
// Requests 1–3 should return 200. Request 4 should return 429.
export function rateLimitPasswordResetScenario(data: Data): void {
  const res = http.post(
    `${data.baseUrl}/user/password/reset`,
    JSON.stringify({ email: "ratelimit-reset@k6.test" }),
    {
      headers: { "Content-Type": "application/json" },
      tags:    { name: "rate_limit_password_reset" },
    },
  );

  if (res.status === 429) rateLimitHits.add(1);

  check(res, {
    "rate limit reset: no 5xx":           (r) => r.status < 500,
    "rate limit reset: 200 or 429 only":  (r) => r.status === 200 || r.status === 429,
  });
}

// ── Performance scenarios ───────────────────────────────────────────────────────

// Exercises POST /project/:id/chart/:id/filter — the checkFilterAccess middleware.
// This is the route where project and chart are now fetched in parallel.
export function chartFilterScenario(data: Data): void {
  const res = http.post(
    `${data.baseUrl}/project/${data.projectId}/chart/${data.chartId}/filter`,
    JSON.stringify({ filters: [], variables: {} }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${data.token}`,
      },
      tags: { name: "chart_filter" },
    },
  );

  filterLatency.add(res.timings.duration);

  // Only count 5xx as errors — 4xx (401, 403, 404) indicate test data or auth
  // issues (wrong chart ID, no access) rather than backend failures.
  filterErrors.add(res.status >= 500);

  check(res, {
    "filter: no 5xx":      (r) => r.status < 500,
    "filter: under 500ms": (r) => r.timings.duration < 500,
  });

  sleep(1);
}

// Unauthenticated GET of a public dashboard — high-frequency in production.
// Skipped (with a placeholder sleep) when CB_BREW_NAME is not provided.
export function publicDashboardScenario(data: Data): void {
  if (!data.brewName) {
    sleep(2);
    return;
  }

  const res = http.get(
    `${data.baseUrl}/project/dashboard/${data.brewName}`,
    { tags: { name: "public_dashboard" } },
  );

  check(res, {
    "dashboard: 200 or 403":  (r) => r.status === 200 || r.status === 403,
    "dashboard: under 1s":    (r) => r.timings.duration < 1000,
  });

  sleep(2);
}

// Simulates a user opening the app: GET teams → GET projects → GET charts.
// These are fast DB reads that dominate real-world traffic.
export function teamProjectReadScenario(data: Data): void {
  const headers = { Authorization: `Bearer ${data.token}` };

  group("authenticated reads", () => {
    const teamRes = http.get(
      `${data.baseUrl}/team`,
      { headers, tags: { name: "get_teams" } },
    );
    check(teamRes, {
      "GET /team: 200":          (r) => r.status === 200,
      "GET /team: under 300ms":  (r) => r.timings.duration < 300,
    });
    sleep(0.5);

    const projectRes = http.get(
      `${data.baseUrl}/project/team/${data.teamId}`,
      { headers, tags: { name: "get_projects" } },
    );
    check(projectRes, {
      "GET /project/team: 200 or 403":    (r) => r.status === 200 || r.status === 403,
      "GET /project/team: under 300ms":   (r) => r.timings.duration < 300,
    });
    sleep(0.5);

    const chartRes = http.get(
      `${data.baseUrl}/project/${data.projectId}/chart`,
      { headers, tags: { name: "get_charts" } },
    );
    check(chartRes, {
      "GET /chart: 200 or 403":    (r) => r.status === 200 || r.status === 403,
      "GET /chart: under 300ms":   (r) => r.timings.duration < 300,
    });
  });

  sleep(2);
}

// POST /project/:id/chart/:id/query — triggers a live data refresh from the
// underlying data source. Kept at low concurrency (5 VUs) as it is expensive.
export function chartQueryScenario(data: Data): void {
  const res = http.post(
    `${data.baseUrl}/project/${data.projectId}/chart/${data.chartId}/query`,
    JSON.stringify({ filters: [], variables: {} }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${data.token}`,
      },
      tags: { name: "chart_query" },
    },
  );

  queryErrors.add(res.status >= 500);

  check(res, {
    "query: no 5xx":   (r) => r.status < 500,
    "query: under 2s": (r) => r.timings.duration < 2000,
  });

  sleep(3);
}

// k6 requires a default export even when every scenario specifies exec.
export default function (_data: Data): void {}
