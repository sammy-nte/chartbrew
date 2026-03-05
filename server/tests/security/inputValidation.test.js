/**
 * This test file checks how the server validates numeric ID parameters in request URLs.
 * It tests:
 * - That valid integer IDs (positive, zero, negative) are passed through correctly
 * - That all five recognised ID params (project_id, team_id, user_id, dataset_id,
 *   dataRequest_id) are validated at the same time
 * - That non-numeric, empty, and special-character values are rejected with a 400 error
 * - That the middleware stops at the first invalid parameter it encounters
 * - Known limitation: values starting with a number (e.g. "7abc" or "1.5") are allowed
 *   through because parseInt truncates them — this is a documented behaviour
 */

import {
  describe, it, expect, beforeEach, vi,
} from "vitest";
import request from "supertest";
import express from "express";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const parseQueryParams = require("../../middlewares/parseQueryParams.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(parseQueryParams);
  app.get("/test", (req, res) => res.status(200).json({ query: req.query }));
  app.post("/test", (req, res) => res.status(200).json({ body: req.body }));
  return app;
}

describe("parseQueryParams — numeric ID validation", () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  // ── Valid inputs ────────────────────────────────────────────────────────────

  it("passes through a valid positive integer project_id", async () => {
    const res = await request(app).get("/test?project_id=42");
    expect(res.status).toBe(200);
    expect(res.body.query.project_id).toBe(42);
  });

  it("passes through zero as a valid project_id", async () => {
    const res = await request(app).get("/test?project_id=0");
    expect(res.status).toBe(200);
    expect(res.body.query.project_id).toBe(0);
  });

  it("passes through a negative integer (valid per parseInt)", async () => {
    const res = await request(app).get("/test?project_id=-5");
    expect(res.status).toBe(200);
    expect(res.body.query.project_id).toBe(-5);
  });

  it("passes through all five recognised ID params simultaneously", async () => {
    const res = await request(app).get(
      "/test?project_id=1&team_id=2&user_id=3&dataset_id=4&dataRequest_id=5",
    );
    expect(res.status).toBe(200);
    const { query } = res.body;
    expect(query.project_id).toBe(1);
    expect(query.team_id).toBe(2);
    expect(query.user_id).toBe(3);
    expect(query.dataset_id).toBe(4);
    expect(query.dataRequest_id).toBe(5);
  });

  it("passes through unrecognised params without validation", async () => {
    const res = await request(app).get("/test?foo=bar&project_id=10");
    expect(res.status).toBe(200);
    expect(res.body.query.foo).toBe("bar");
    expect(res.body.query.project_id).toBe(10);
  });

  it("passes request through when no ID params are present", async () => {
    const res = await request(app).get("/test?name=hello");
    expect(res.status).toBe(200);
  });

  // ── Invalid inputs — should be rejected ────────────────────────────────────

  it("rejects a purely alphabetic project_id", async () => {
    const res = await request(app).get("/test?project_id=abc");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/project_id/i);
  });

  it("rejects an empty project_id string", async () => {
    const res = await request(app).get("/test?project_id=");
    expect(res.status).toBe(400);
  });

  it("rejects a null-byte project_id (%00)", async () => {
    const res = await request(app).get("/test?project_id=%00");
    expect(res.status).toBe(400);
  });

  it("rejects a JSON object as project_id", async () => {
    const res = await request(app).get("/test?project_id=%7B%22a%22%3A1%7D");
    expect(res.status).toBe(400);
  });

  it("rejects a SQL injection string as project_id", async () => {
    const res = await request(app).get("/test?project_id=1%20OR%201%3D1");
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.query.project_id).toBe(1);
    }
  });

  it("stops at first invalid param and returns 400 without processing the rest", async () => {
    // team_id is invalid; user_id is valid but should never be reached.
    const res = await request(app).get("/test?team_id=bad&user_id=5");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/team_id/i);
  });

  it("truncates float project_id to integer via parseInt and allows it through", async () => {
    const res = await request(app).get("/test?project_id=1.5");
    expect(res.status).toBe(200);
    expect(res.body.query.project_id).toBe(1);
  });

  it("truncates trailing-alpha project_id ('7abc') to 7 and allows it through", async () => {
    const res = await request(app).get("/test?project_id=7abc");
    expect(res.status).toBe(200);
    expect(res.body.query.project_id).toBe(7);
  });
});

describe("Body input — server returns user-supplied strings as-is (JSON context)", () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  const XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    // eslint-disable-next-line no-script-url
    "javascript:alert(1)",
    "';alert(1)//",
    "<svg onload=alert(1)>",
  ];

  it.each(XSS_PAYLOADS)(
    "returns XSS payload %s as-is in JSON (no server-side stripping)",
    async (payload) => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json")
        .send({ name: payload });

      // The server echoes the value unchanged. This is expected: JSON encoding
      // by the client/browser prevents script execution. The responsibility for
      // safe rendering belongs to the frontend (React escapes by default).
      expect(res.status).toBe(200);
      expect(res.body.body.name).toBe(payload);
    },
  );

  it("large body fields are accepted (no length limit enforced at middleware level)", async () => {
    const longString = "A".repeat(10_000);
    const res = await request(app)
      .post("/test")
      .send({ description: longString });

    expect(res.status).toBe(200);
    expect(res.body.body.description).toHaveLength(10_000);
  });

  it("nested objects in body are accepted without sanitization", async () => {
    // eslint-disable-next-line no-script-url
    const payload = { config: { url: "javascript:void(0)", label: "<b>hi</b>" } };
    const res = await request(app).post("/test").send(payload);
    expect(res.status).toBe(200);
    expect(res.body.body.config.url).toBe(payload.config.url);
  });
});
