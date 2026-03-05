/**
 * This test file checks the Saved Query API routes.
 * It tests:
 * - That all saved query endpoints reject unauthenticated requests (401)
 * - That the admin-only route to list all saved queries is blocked for regular users
 * - That saved queries can be listed, created, updated, and deleted within a team
 * - That users outside a team are blocked from accessing its saved queries (403)
 * - That requests for non-existent saved queries return 404
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

describe("SavedQuery Routes", () => {
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
    const savedQueryRoute = require("../../api/SavedQueryRoute.js");
    savedQueryRoute(app);
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

  // ---- GET /savedQuery (admin-only) ----
  describe("GET /savedQuery", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/savedQuery");
      expect(res.status).toBe(401);
    });

    it("should return 401 for non-admin users", async () => {
      const res = await request(app)
        .get("/savedQuery")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 200 for admin users", async () => {
      const adminUser = await models.User.create(userFactory.buildAdmin({
        email: `admin-sq-${Date.now()}@test.com`,
      }));
      await models.User.update({ admin: true }, { where: { id: adminUser.id }, hooks: false });
      const adminToken = generateTestToken({ id: adminUser.id, email: adminUser.email });

      const res = await request(app)
        .get("/savedQuery")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /team/:team_id/savedQuery ----
  describe("GET /team/:team_id/savedQuery", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/savedQuery");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-sq-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/team/${team.id}/savedQuery`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 and an array when user has access", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/savedQuery`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /team/:team_id/savedQuery ----
  describe("POST /team/:team_id/savedQuery", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/savedQuery")
        .send({ name: "My Query", query: "SELECT 1" });
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-sq-create-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .post(`/team/${team.id}/savedQuery`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ name: "My Query" });
      expect(res.status).toBe(403);
    });

    it("should return 200 and create a saved query when user has access", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/savedQuery`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ summary: "Test Query", query: "SELECT 1", type: "api" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("summary", "Test Query");
    });
  });

  // ---- PUT /team/:team_id/savedQuery/:id ----
  describe("PUT /team/:team_id/savedQuery/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1/savedQuery/1")
        .send({ name: "Updated Query" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when saved query does not belong to team", async () => {
      const res = await request(app)
        .put(`/team/${team.id}/savedQuery/99999`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated Query" });
      expect(res.status).toBe(404);
    });

    it("should return 200 when saved query is updated successfully", async () => {
      const savedQuery = await models.SavedQuery.create({
        summary: "Original Query",
        query: "SELECT 1",
        type: "api",
        team_id: team.id,
        user_id: user.id,
      });

      const res = await request(app)
        .put(`/team/${team.id}/savedQuery/${savedQuery.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ summary: "Updated Query" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("summary", "Updated Query");
    });
  });

  // ---- DELETE /team/:team_id/savedQuery/:id ----
  describe("DELETE /team/:team_id/savedQuery/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1/savedQuery/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when saved query does not belong to team", async () => {
      const res = await request(app)
        .delete(`/team/${team.id}/savedQuery/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when saved query is deleted successfully", async () => {
      const savedQuery = await models.SavedQuery.create({
        name: "Delete Me",
        query: "SELECT 1",
        type: "api",
        team_id: team.id,
        user_id: user.id,
      });

      const res = await request(app)
        .delete(`/team/${team.id}/savedQuery/${savedQuery.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
    });
  });
});
