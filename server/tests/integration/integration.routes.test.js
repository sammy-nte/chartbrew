/**
 * This test file checks the Integration API routes (Slack, webhooks).
 * It tests:
 * - That all integration endpoints reject unauthenticated requests (401)
 * - That integrations can be listed, created, updated, and deleted within a team
 * - That requests for non-existent integrations return 404
 * - That creating an integration with a mismatched or missing team_id is rejected (400)
 * - That a successful delete returns { deleted: true }
 */
import {
  describe, it, expect, beforeAll, beforeEach
} from "vitest";
import request from "supertest";
import { createRequire } from "module";

import { createTestApp } from "../helpers/testApp.js";
import { testDbManager } from "../helpers/testDbManager.js";
import { getModels } from "../helpers/dbHelpers.js";
import { generateTestToken } from "../helpers/authHelpers.js";
import { userFactory, teamFactory } from "../factories/index.js";

const require = createRequire(import.meta.url);

describe("Integration Routes", () => {
  let app;
  let models;
  let user;
  let team;
  let authToken;

  beforeAll(async () => {
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }
    app = await createTestApp();
    const integrationRoute = require("../../api/IntegrationRoute.js");
    integrationRoute(app);
    models = await getModels();
  });

  beforeEach(async () => {
    if (!testDbManager.getSequelize()) return;
    user = await models.User.create(userFactory.build());
    team = await models.Team.create(teamFactory.build());
    await models.TeamRole.create({
      user_id: user.id,
      team_id: team.id,
      role: "teamOwner",
    });
    authToken = generateTestToken({ id: user.id, email: user.email });
  });

  // ---- GET /team/:team_id/integration ----
  describe("GET /team/:team_id/integration", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/integration");
      expect(res.status).toBe(401);
    });

    it("should return 401 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-int-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(401);
    });

    it("should return 200 and an array when user has access", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /team/:team_id/integration/:id ----
  describe("GET /team/:team_id/integration/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/integration/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when integration does not exist", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/integration/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /team/:team_id/integration ----
  describe("POST /team/:team_id/integration", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/integration")
        .send({ team_id: 1, type: "slack" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when team_id in body does not match URL param", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ team_id: 99999, type: "slack" });
      expect(res.status).toBe(400);
    });

    it("should return 400 when team_id is missing from body", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ type: "slack" });
      expect(res.status).toBe(400);
    });

    it("should return 200 and create an integration when valid", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          team_id: team.id,
          type: "webhook",
          name: "Test Webhook",
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
    });
  });

  // ---- PUT /team/:team_id/integration/:id ----
  describe("PUT /team/:team_id/integration/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1/integration/1")
        .send({ name: "Updated" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when integration does not exist", async () => {
      const res = await request(app)
        .put(`/team/${team.id}/integration/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated" });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /team/:team_id/integration/:id ----
  describe("DELETE /team/:team_id/integration/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1/integration/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when integration does not exist", async () => {
      const res = await request(app)
        .delete(`/team/${team.id}/integration/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when integration is deleted successfully", async () => {
      // First create an integration
      const createRes = await request(app)
        .post(`/team/${team.id}/integration`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          team_id: team.id,
          type: "webhook",
          name: "Integration to delete",
        });
      expect(createRes.status).toBe(200);

      const integrationId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/team/${team.id}/integration/${integrationId}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toHaveProperty("deleted", true);
    });
  });
});
