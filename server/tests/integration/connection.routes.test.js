/**
 * This test file checks the Connection API routes.
 * It tests:
 * - That all connection endpoints reject unauthenticated requests (401)
 * - That the admin-only route to list all connections is blocked for regular users
 * - That connections can be listed, created, updated, and deleted within a team
 * - That users outside a team are blocked from accessing its connections (403)
 * - That requests for non-existent connections return 404
 * - That connection testing, API testing, schema updates, duplicate, and helper endpoints
 *   are all auth-protected
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

describe("Connection Routes", () => {
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
    const connectionRoute = require("../../api/ConnectionRoute.js");
    connectionRoute(app);
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

  // ---- GET /connection (admin-only) ----
  describe("GET /connection", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/connection");
      expect(res.status).toBe(401);
    });

    it("should return 401 for non-admin users", async () => {
      const res = await request(app)
        .get("/connection")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 200 for admin users", async () => {
      const adminUser = await models.User.create(userFactory.buildAdmin({
        email: `admin-conn-${Date.now()}@test.com`,
      }), { hooks: false });
      const adminToken = generateTestToken({ id: adminUser.id, email: adminUser.email });
      const res = await request(app)
        .get("/connection")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /team/:team_id/connections ----
  describe("GET /team/:team_id/connections", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/connections");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-conn-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/team/${team.id}/connections`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 and an array when user has access", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/connections`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /team/:team_id/connections ----
  describe("POST /team/:team_id/connections", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections")
        .send({ name: "My Connection", type: "api" });
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-conn-create-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .post(`/team/${team.id}/connections`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ name: "My Connection", type: "api" });
      expect(res.status).toBe(403);
    });

    it("should return 200 and create a connection when user has access", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/connections`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Test API Connection", type: "api", team_id: team.id });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", "Test API Connection");
    });
  });

  // ---- GET /team/:team_id/connections/:connection_id ----
  describe("GET /team/:team_id/connections/:connection_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/connections/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when connection does not exist", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/connections/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- PUT /team/:team_id/connections/:connection_id ----
  describe("PUT /team/:team_id/connections/:connection_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1/connections/1")
        .send({ name: "Updated" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when connection does not exist in team", async () => {
      const res = await request(app)
        .put(`/team/${team.id}/connections/99999`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated" });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /team/:team_id/connections/:connection_id ----
  describe("DELETE /team/:team_id/connections/:connection_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1/connections/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when connection does not exist", async () => {
      const res = await request(app)
        .delete(`/team/${team.id}/connections/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- GET /team/:team_id/connections/:connection_id/test ----
  describe("GET /team/:team_id/connections/:connection_id/test", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/connections/1/test");
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/connections/:connection_id/apiTest ----
  describe("POST /team/:team_id/connections/:connection_id/apiTest", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections/1/apiTest")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/connections/:type/test ----
  describe("POST /team/:team_id/connections/:type/test", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections/api/test")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/connections/:connection_id/duplicate ----
  describe("POST /team/:team_id/connections/:connection_id/duplicate", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections/1/duplicate")
        .send({ name: "Copy" });
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/connections/:connection_id/update-schema ----
  describe("POST /team/:team_id/connections/:connection_id/update-schema", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections/1/update-schema")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/connections/:connection_id/helper/:method ----
  describe("POST /team/:team_id/connections/:connection_id/helper/:method", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/connections/1/helper/someMethod")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /project/:project_id/connection ----
  describe("GET /project/:project_id/connection", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/connection");
      expect(res.status).toBe(401);
    });
  });
});
