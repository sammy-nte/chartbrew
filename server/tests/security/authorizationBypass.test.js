/**
 * This test file checks a specific security bug where a permission check is called
 * without being awaited, causing it to be silently ignored.
 *
 * The bug: if a route handler is not async and does not await checkAccess(), the
 * rejected Promise is never caught and the downstream controller runs for any
 * authenticated user regardless of whether they belong to the team.
 *
 * It tests:
 * - The vulnerable pattern: that a non-awaited checkAccess() lets the request through
 *   even when access should be denied (demonstrating the bug)
 * - The fixed pattern: that awaiting checkAccess() correctly blocks unauthorized requests
 * - That the downstream handler never runs before the access check has settled
 * - That no route files contain bare (not-awaited) checkAccess() calls (static analysis)
 * - That every TemplateRoute endpoint rejects unauthenticated requests with 401
 */

import {
  describe, it, expect, vi, beforeEach
} from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_DIR = resolve(__dirname, "../../api");
const SLACK_API_DIR = resolve(__dirname, "../../apps/slack/api");

function getRouteFiles() {
  const files = [];
  for (const f of readdirSync(API_DIR)) {
    if (f.endsWith("Route.js")) {
      files.push({ name: f, path: join(API_DIR, f) });
    }
  }
  if (existsSync(SLACK_API_DIR)) {
    for (const f of readdirSync(SLACK_API_DIR)) {
      if (f.endsWith("Route.js")) {
        files.push({ name: f, path: join(SLACK_API_DIR, f) });
      }
    }
  }
  return files;
}

function makeTemplateApp() {
  const app = express();
  app.use(express.json());
  const templateRoute = require("../../api/TemplateRoute");
  templateRoute(app);
  return app;
}

describe("Unawaited Permission Check — vulnerability pattern", () => {
  const DENIED = () => {
    const p = Promise.reject(new Error("401"));
    p.catch(() => {}); // suppress unhandled-rejection warning
    return p;
  };
  const GRANTED = () => Promise.resolve({ role: "teamAdmin" });

  function buildVulnerableApp(checkAccess, downstream) {
    const app = express();
    // eslint-disable-next-line consistent-return
    app.get("/protected", (req, res) => {
      try {
        checkAccess();
      } catch (_err) {
        return res.status(401).json({ error: "unauthorized" });
      }
      return downstream(req, res);
    });
    return app;
  }

  function buildFixedApp(checkAccess, downstream) {
    const app = express();
    app.get("/protected", async (req, res) => {
      try {
        await checkAccess();
      } catch (_err) {
        return res.status(401).json({ error: "unauthorized" });
      }
      return downstream(req, res);
    });
    return app;
  }

  let downstreamSpy;
  beforeEach(() => {
    downstreamSpy = vi.fn((req, res) => res.status(200).json({ secret: "data" }),
    );
  });

  // ── Demonstrates the vulnerability ─────────────────────────────────────────

  describe("Vulnerable (no await) — access control is bypassed", () => {
    it("downstream handler executes even when checkAccess rejects", async () => {
      const app = buildVulnerableApp(DENIED, downstreamSpy);
      const res = await request(app).get("/protected");
      expect(downstreamSpy).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  // ── Demonstrates the fix ───────────────────────────────────────────────────

  describe("Fixed (with await) — access control is enforced", () => {
    it("blocks the request and skips downstream when checkAccess rejects", async () => {
      const app = buildFixedApp(DENIED, downstreamSpy);
      const res = await request(app).get("/protected");

      expect(downstreamSpy).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
    });

    it("allows the request through when checkAccess resolves", async () => {
      const app = buildFixedApp(GRANTED, downstreamSpy);
      const res = await request(app).get("/protected");

      expect(downstreamSpy).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("downstream never executes before the access check has settled", async () => {
      const order = [];
      const slowCheck = async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("access-check");
      };
      const orderedDownstream = (req, res) => {
        order.push("downstream");
        return res.status(200).end();
      };

      await request(buildFixedApp(slowCheck, orderedDownstream)).get(
        "/protected",
      );

      expect(order).toEqual(["access-check", "downstream"]);
    });

    it("data-fetching handler is not called when access is denied", async () => {
      const fetchData = vi.fn(() => Promise.resolve({ charts: [] }));

      // eslint-disable-next-line max-len
      const app = buildFixedApp(DENIED, (_req, res) => fetchData().then((d) => res.status(200).json(d)),
      );

      const res = await request(app).get("/protected");

      expect(res.status).toBe(401);
      expect(fetchData).not.toHaveBeenCalled();
    });
  });
});

describe("Static Analysis: no bare checkAccess() calls in route files", () => {
  it("all checkAccess() invocations are preceded by await or return", () => {
    const violations = [];

    for (const { name, path: filePath } of getRouteFiles()) {
      const source = readFileSync(filePath, "utf8");

      source.split("\n").forEach((line, idx) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return;

        if (
          /^(?:const|let|var|(?:async\s+)?function)\s+checkAccess\b/.test(
            trimmed,
          )
        ) return;

        if (
          /\bcheckAccess\s*\(/.test(trimmed)
          && !/\bawait\s+checkAccess\s*\(/.test(trimmed)
          && !/\breturn\s+checkAccess\s*\(/.test(trimmed)
        ) {
          violations.push({
            file: name,
            line: idx + 1,
            code: trimmed.slice(0, 100),
          });
        }
      });
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  →  ${v.code}`)
        .join("\n");
      expect.fail(
        `Auth Bypass: ${violations.length} unawaited checkAccess call(s) found.\n`
          + `Fix each by adding \`await\` and making the handler \`async\`:\n${detail}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

const TEAM_ID = "42";
const PROJECT_ID = "99";
const TEMPLATE_ID = "7";

describe("TemplateRoute smoke: unauthenticated requests are rejected on every endpoint", () => {
  let app;

  beforeEach(() => {
    app = makeTemplateApp();
  });

  it("GET /team/:id/template — 401 without token", async () => {
    const res = await request(app).get(`/team/${TEAM_ID}/template`);
    expect(res.status).toBe(401);
  });

  it("GET /team/:id/template/community/:template — 401 without token", async () => {
    const res = await request(app).get(
      `/team/${TEAM_ID}/template/community/some`,
    );
    expect(res.status).toBe(401);
  });

  it("GET /team/:id/template/custom/:template_id — 401 without token", async () => {
    const res = await request(app).get(
      `/team/${TEAM_ID}/template/custom/${TEMPLATE_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("GET /team/:id/template/generate/:project_id — 401 without token)", async () => {
    const res = await request(app).get(
      `/team/${TEAM_ID}/template/generate/${PROJECT_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("POST /team/:id/template — 401 without token", async () => {
    const res = await request(app)
      .post(`/team/${TEAM_ID}/template`)
      .send({ name: "My Template" });
    expect(res.status).toBe(401);
  });

  it("PUT /team/:id/template/:template_id — 401 without token", async () => {
    const res = await request(app)
      .put(`/team/${TEAM_ID}/template/${TEMPLATE_ID}`)
      .send({ name: "Updated" });
    expect(res.status).toBe(401);
  });

  it("DELETE /team/:id/template/:template_id — 401 without token", async () => {
    const res = await request(app).delete(
      `/team/${TEAM_ID}/template/${TEMPLATE_ID}`,
    );
    expect(res.status).toBe(401);
  });
});
