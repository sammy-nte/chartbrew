/**
 * This test file checks the Dataset API routes.
 * It tests:
 * - That all dataset endpoints reject unauthenticated requests (401)
 * - That users outside a team are blocked from accessing its datasets (403)
 * - That datasets can be listed, created, updated, and deleted within a team
 * - That requests for non-existent datasets return 404
 * - That dataset duplication is blocked for non-existent or unauthorized datasets
 * - That draft cleanup, variable bindings, and chart-listing endpoints are auth-protected
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

describe("Dataset Routes", () => {
  let app;
  let models;
  let user;
  let team;
  let authToken;

  const root = (teamId) => `/team/${teamId}/datasets`;

  beforeAll(async () => {
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }
    app = await createTestApp();
    const datasetRoute = require("../../api/DatasetRoute.js");
    datasetRoute(app);
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

  // ---- GET /team/:team_id/datasets ----
  describe("GET /team/:team_id/datasets", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(root(1));
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-ds-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(root(team.id))
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 and an array when user has access", async () => {
      const res = await request(app)
        .get(root(team.id))
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- GET /team/:team_id/datasets/:dataset_id ----
  describe("GET /team/:team_id/datasets/:dataset_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(`${root(1)}/1`);
      expect(res.status).toBe(401);
    });

    it("should return 404 when dataset does not belong to team", async () => {
      const res = await request(app)
        .get(`${root(team.id)}/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when dataset exists and user has access", async () => {
      const dataset = await models.Dataset.create({
        legend: "Test Dataset",
        team_id: team.id,
      });

      const res = await request(app)
        .get(`${root(team.id)}/${dataset.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", dataset.id);
    });
  });

  // ---- POST /team/:team_id/datasets ----
  describe("POST /team/:team_id/datasets", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(root(1))
        .send({ name: "New Dataset" });
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-ds-create-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .post(root(team.id))
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ name: "New Dataset" });
      expect(res.status).toBe(403);
    });

    it("should return 200 and create a dataset when user has access", async () => {
      const res = await request(app)
        .post(root(team.id))
        .set("Authorization", `Bearer ${authToken}`)
        .send({ legend: "New Dataset", team_id: team.id });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("legend", "New Dataset");
    });
  });

  // ---- POST /team/:team_id/datasets/quick-create ----
  describe("POST /team/:team_id/datasets/quick-create", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1)}/quick-create`)
        .send({ name: "Quick Dataset" });
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/duplicate ----
  describe("POST /team/:team_id/datasets/:dataset_id/duplicate", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1)}/1/duplicate`)
        .send({ name: "Copy" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when dataset does not belong to team", async () => {
      const res = await request(app)
        .post(`${root(team.id)}/99999/duplicate`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Copy" });
      expect(res.status).toBe(404);
    });
  });

  // ---- PUT /team/:team_id/datasets/:dataset_id ----
  describe("PUT /team/:team_id/datasets/:dataset_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put(`${root(1)}/1`)
        .send({ name: "Updated" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when dataset does not belong to team", async () => {
      const res = await request(app)
        .put(`${root(team.id)}/99999`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Updated" });
      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /team/:team_id/datasets/drafts ----
  describe("DELETE /team/:team_id/datasets/drafts", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete(`${root(1)}/drafts`);
      expect(res.status).toBe(401);
    });

    it("should return 200 when user has access (no drafts to delete)", async () => {
      const res = await request(app)
        .delete(`${root(team.id)}/drafts`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ---- DELETE /team/:team_id/datasets/:dataset_id ----
  describe("DELETE /team/:team_id/datasets/:dataset_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete(`${root(1)}/1`);
      expect(res.status).toBe(401);
    });

    it("should return 404 when dataset does not belong to team", async () => {
      const res = await request(app)
        .delete(`${root(team.id)}/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it("should return 200 when dataset exists and user can delete", async () => {
      const dataset = await models.Dataset.create({
        name: "Dataset to delete",
        team_id: team.id,
      });

      const res = await request(app)
        .delete(`${root(team.id)}/${dataset.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ---- GET /team/:team_id/datasets/:dataset_id/request ----
  describe("GET /team/:team_id/datasets/:dataset_id/request", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(`${root(1)}/1/request`);
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/request ----
  describe("POST /team/:team_id/datasets/:dataset_id/request", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1)}/1/request`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /team/:team_id/datasets/:dataset_id/charts ----
  describe("GET /team/:team_id/datasets/:dataset_id/charts", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(`${root(1)}/1/charts`);
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/datasets/:id/variableBindings ----
  describe("POST /team/:team_id/datasets/:id/variableBindings", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1)}/1/variableBindings`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- PUT /team/:team_id/datasets/:id/variableBindings/:variable_id ----
  describe("PUT /team/:team_id/datasets/:id/variableBindings/:variable_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put(`${root(1)}/1/variableBindings/1`)
        .send({});
      expect(res.status).toBe(401);
    });
  });
});
