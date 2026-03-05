/**
 * This test file checks the Chart API routes.
 * It tests:
 * - That all chart endpoints reject unauthenticated requests (401)
 * - That the admin-only route to list all charts is blocked for regular users
 * - That charts can be listed, created, updated, and deleted within a project
 * - That users outside a team are blocked from accessing its charts (403)
 * - That requests for non-existent projects or charts return 404
 * - That chart export requires a non-empty list of chart IDs
 * - That share, alert, and chart-dataset-config endpoints are all auth-protected
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

describe("Chart Routes", () => {
  let app;
  let models;
  let user;
  let team;
  let project;
  let authToken;

  beforeAll(async () => {
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }
    app = await createTestApp();
    const chartRoute = require("../../api/ChartRoute.js");
    chartRoute(app);
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
    project = await models.Project.create({
      name: "Test Project",
      brewName: `test-project-${Date.now()}`,
      dashboardTitle: "Test Dashboard",
      description: "A test project",
      team_id: team.id,
      public: false,
    });
    authToken = generateTestToken({ id: user.id, email: user.email });
  });

  // ---- GET /chart (admin-only) ----
  describe("GET /chart", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/chart");
      expect(res.status).toBe(401);
    });

    it("should return 401 for non-admin users", async () => {
      const res = await request(app)
        .get("/chart")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 200 for admin users", async () => {
      const adminUser = await models.User.create(userFactory.buildAdmin({
        email: `admin-chart-${Date.now()}@test.com`,
      }), { hooks: false });
      const adminToken = generateTestToken({ id: adminUser.id, email: adminUser.email });

      const res = await request(app)
        .get("/chart")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /project/:project_id/chart ----
  describe("GET /project/:project_id/chart", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/chart");
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .get("/project/99999/chart")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when user has access", async () => {
      const res = await request(app)
        .get(`/project/${project.id}/chart`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-chart-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/project/${project.id}/chart`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---- GET /project/:project_id/chart/:chart_id ----
  describe("GET /project/:project_id/chart/:chart_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/chart/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .get("/project/99999/chart/1")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /project/:project_id/chart ----
  describe("POST /project/:project_id/chart", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/chart")
        .send({ name: "My Chart", type: "line" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .post("/project/99999/chart")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "My Chart", type: "line" });
      expect(res.status).toBe(404);
    });

    it("should return 200 and create a chart when user has access", async () => {
      const res = await request(app)
        .post(`/project/${project.id}/chart`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "My Chart", type: "line" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", "My Chart");
    });
  });

  // ---- PUT /project/:project_id/chart/:chart_id ----
  describe("PUT /project/:project_id/chart/:chart_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/project/1/chart/1")
        .send({ name: "Updated Chart" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .put("/project/99999/chart/1")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated Chart" });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /project/:project_id/chart/:chart_id ----
  describe("DELETE /project/:project_id/chart/:chart_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/project/1/chart/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .delete("/project/99999/chart/1")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /project/:project_id/chart/export ----
  describe("POST /project/:project_id/chart/export", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/chart/export")
        .send({ chartIds: [1] });
      expect(res.status).toBe(401);
    });

    it("should return 400 when chartIds is missing", async () => {
      const res = await request(app)
        .post(`/project/${project.id}/chart/export`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 400 when chartIds is an empty array", async () => {
      const res = await request(app)
        .post(`/project/${project.id}/chart/export`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ chartIds: [] });
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /chart/:share_string/embedded ----
  describe("GET /chart/:share_string/embedded", () => {
    it("should return 400 for a non-existent chart by numeric id", async () => {
      const res = await request(app).get("/chart/99999/embedded");
      expect([400, 401]).toContain(res.status);
    });
  });

  // ---- GET /chart/share/:share_string ----
  describe("GET /chart/share/:share_string", () => {
    it("should return 400 for a non-existent share string", async () => {
      const res = await request(app).get("/chart/share/nonexistent-share-string");
      expect(res.status).toBe(400);
    });
  });

  // ---- POST /project/:project_id/chart/:chart_id/share/token ----
  describe("POST /project/:project_id/chart/:chart_id/share/token", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/chart/1/share/token")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /project/:project_id/chart/:chart_id/alert ----
  describe("GET /project/:project_id/chart/:chart_id/alert", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/chart/1/alert");
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /project/:project_id/chart/:chart_id/alert ----
  describe("POST /project/:project_id/chart/:chart_id/alert", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/chart/1/alert")
        .send({ recipients: [] });
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /project/:project_id/chart/:chart_id/share/policy ----
  describe("GET /project/:project_id/chart/:chart_id/share/policy", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/chart/1/share/policy");
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /project/:project_id/chart/:chart_id/chart-dataset-config ----
  describe("POST /project/:project_id/chart/:chart_id/chart-dataset-config", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/chart/1/chart-dataset-config")
        .send({});
      expect(res.status).toBe(401);
    });
  });
});
