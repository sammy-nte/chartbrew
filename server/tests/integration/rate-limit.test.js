/**
 * This test file checks that rate limiting is applied correctly to sensitive endpoints.
 * It tests:
 * - That POST /user/login is blocked after 5 requests within the rate limit window (429)
 * - That POST /user/password/reset is blocked after 3 requests (429)
 * - That POST /user/:id/2fa/:method_id/login is blocked after 3 requests (429)
 * - That POST /ai/orchestrate is blocked after 3 requests (429)
 * Each endpoint has its own independent rate limiter, so that tests for different
 * endpoints do not interfere with each other.
 */
import {
  describe, it, expect, beforeAll,
} from "vitest";
import request from "supertest";
import { createRequire } from "module";

import { createTestApp } from "../helpers/testApp.js";
import { testDbManager } from "../helpers/testDbManager.js";

const require = createRequire(import.meta.url);

describe("Rate Limiting", () => {
  let app;

  beforeAll(async () => {
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }
    app = await createTestApp();

    const userRoute = require("../../api/UserRoute.js");
    const aiRoute = require("../../api/AiRoute.js");
    userRoute(app);
    aiRoute(app);
  });

  // ── POST /user/login — 5 per 15 minutes ──────────────────────────────────
  describe("POST /user/login", () => {
    it("should return 429 after 5 requests within the window", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/user/login")
          .send({ email: "ratelimit-login@test.com", password: "wrongpassword" });
        expect(res.status).not.toBe(429);
      }

      const blocked = await request(app)
        .post("/user/login")
        .send({ email: "ratelimit-login@test.com", password: "wrongpassword" });
      expect(blocked.status).toBe(429);
    });
  });

  // ── POST /user/password/reset — 3 per 15 minutes ─────────────────────────
  describe("POST /user/password/reset", () => {
    it("should return 429 after 3 requests within the window", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/user/password/reset")
          .send({ email: "ratelimit-reset@test.com" });
        expect(res.status).not.toBe(429);
      }

      const blocked = await request(app)
        .post("/user/password/reset")
        .send({ email: "ratelimit-reset@test.com" });
      expect(blocked.status).toBe(429);
    });
  });

  // ── POST /user/:id/2fa/:method_id/login — 3 per minute ───────────────────
  describe("POST /user/:id/2fa/:method_id/login", () => {
    it("should return 429 after 3 requests within the window", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/user/999999/2fa/999999/login")
          .send({ token: "000000" });
        expect(res.status).not.toBe(429);
      }

      const blocked = await request(app)
        .post("/user/999999/2fa/999999/login")
        .send({ token: "000000" });
      expect(blocked.status).toBe(429);
    });
  });

  // ── POST /ai/orchestrate — 3 per minute ──────────────────────────────────
  describe("POST /ai/orchestrate", () => {
    it("should return 429 after 3 requests within the window", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/ai/orchestrate")
          .send({ question: "test" });
        expect(res.status).not.toBe(429);
      }

      const blocked = await request(app)
        .post("/ai/orchestrate")
        .send({ question: "test" });
      expect(blocked.status).toBe(429);
    });
  });
});
