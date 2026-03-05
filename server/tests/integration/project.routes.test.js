/**
 * This test file checks the Project API routes.
 * It tests:
 * - That all project endpoints reject unauthenticated requests (401)
 * - That the admin-only route to list all projects is blocked for regular users
 * - That projects can be created, read, updated, and deleted
 * - That users outside a team are blocked from accessing its projects (403)
 * - That public projects are accessible without auth via the dashboard route
 * - That private projects require authentication via the dashboard route
 * - That project variables, dashboard filters, and sharing endpoints are all auth-protected
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

describe("Project Routes", () => {
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
    const projectRoute = require("../../api/ProjectRoute.js");
    projectRoute(app);
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
      brewName: `brew-${Date.now()}`,
      dashboardTitle: "Test Dashboard",
      description: "A test project",
      team_id: team.id,
      public: false,
    });
    authToken = generateTestToken({ id: user.id, email: user.email });
  });

  // ---- GET /project (admin-only) ----
  describe("GET /project", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project");
      expect(res.status).toBe(401);
    });

    it("should return 401 for non-admin users", async () => {
      const res = await request(app)
        .get("/project")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 200 for admin users", async () => {
      const adminUser = await models.User.create(userFactory.buildAdmin({
        email: `admin-project-${Date.now()}@test.com`,
      }));
      await models.User.update({ admin: true }, { where: { id: adminUser.id }, hooks: false });
      const adminToken = generateTestToken({ id: adminUser.id, email: adminUser.email });

      const res = await request(app)
        .get("/project")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /project ----
  describe("POST /project", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project")
        .send({ name: "New Project", team_id: 1 });
      expect(res.status).toBe(401);
    });

    it("should return 403 when user has no team role", async () => {
      const res = await request(app)
        .post("/project")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "New Project", team_id: 99999 });
      expect(res.status).toBe(403);
    });

    it("should return 200 and create a project when user has access", async () => {
      const res = await request(app)
        .post("/project")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "New Project", team_id: team.id });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", "New Project");
    });
  });

  // ---- GET /project/:id ----
  describe("GET /project/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .get("/project/99999")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when user has access", async () => {
      const res = await request(app)
        .get(`/project/${project.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", project.id);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-proj-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/project/${project.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---- PUT /project/:id ----
  describe("PUT /project/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/project/1")
        .send({ name: "Updated" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .put("/project/99999")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated" });
      expect(res.status).toBe(404);
    });

    it("should return 200 and update a project when user has access", async () => {
      const res = await request(app)
        .put(`/project/${project.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated Project Name" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("name", "Updated Project Name");
    });
  });

  // ---- DELETE /project/:id ----
  describe("DELETE /project/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/project/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when project does not exist", async () => {
      const res = await request(app)
        .delete("/project/99999")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 and delete the project when user has access", async () => {
      const projectToDelete = await models.Project.create({
        name: "Delete Me",
        brewName: `delete-${Date.now()}`,
        team_id: team.id,
      });

      const res = await request(app)
        .delete(`/project/${projectToDelete.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("removed", true);
    });
  });

  // ---- GET /project/team/:team_id ----
  describe("GET /project/team/:team_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/team/1");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-proj-team-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/project/team/${team.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 and a list of projects for the team", async () => {
      const res = await request(app)
        .get(`/project/team/${team.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /project/dashboard/:brewName (public route with optional auth) ----
  describe("GET /project/dashboard/:brewName", () => {
    it("should return 404 when brewName does not exist", async () => {
      const res = await request(app).get("/project/dashboard/nonexistent-brew-name-xyz");
      expect(res.status).toBe(404);
    });

    it("should return 401 for a private project accessed without auth", async () => {
      const res = await request(app)
        .get(`/project/dashboard/${project.brewName}`);
      expect(res.status).toBe(401);
    });

    it("should return 200 for a public project without auth", async () => {
      const publicProject = await models.Project.create({
        name: "Public Project",
        brewName: `public-${Date.now()}`,
        team_id: team.id,
        public: true,
        passwordProtected: false,
      });

      const res = await request(app).get(`/project/dashboard/${publicProject.brewName}`);
      expect(res.status).toBe(200);
    });
  });

  // ---- GET /project/:brew_name/report ----
  describe("GET /project/:brew_name/report", () => {
    it("should return 400 or 401 for a non-existent brew name", async () => {
      const res = await request(app).get("/project/nonexistent-brew-xyz/report");
      expect([400, 401]).toContain(res.status);
    });
  });

  // ---- GET /project/:id/variables ----
  describe("GET /project/:id/variables", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/variables");
      expect(res.status).toBe(401);
    });

    it("should return 200 and a list of variables when user has access", async () => {
      const res = await request(app)
        .get(`/project/${project.id}/variables`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /project/:id/variables ----
  describe("POST /project/:id/variables", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/variables")
        .send({ name: "myVar", defaultValue: "val" });
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /project/:id/dashboard-filters ----
  describe("GET /project/:id/dashboard-filters", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/dashboard-filters");
      expect(res.status).toBe(401);
    });

    it("should return 200 and an empty list when user has access", async () => {
      const res = await request(app)
        .get(`/project/${project.id}/dashboard-filters`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /project/:id/share/policy ----
  describe("POST /project/:id/share/policy", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).post("/project/1/share/policy");
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /project/:id/share/token ----
  describe("POST /project/:id/share/token", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/project/1/share/token")
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /project/:id/share/policy ----
  describe("GET /project/:id/share/policy", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/project/1/share/policy");
      expect(res.status).toBe(401);
    });
  });
});
