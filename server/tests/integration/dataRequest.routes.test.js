/**
 * This test file checks the Data Request API routes.
 * It tests:
 * - That all data request endpoints reject unauthenticated requests (401)
 * - That users outside a team are blocked from listing or deleting data requests (403)
 * - That deleting an existing data request returns { deleted: true }
 * - That the request execution, AI assistant, and variable binding endpoints are auth-protected
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

describe("DataRequest Routes", () => {
  let app;
  let models;
  let user;
  let team;
  let dataset;
  let authToken;

  // All DataRequest routes are nested under /team/:team_id/datasets/:dataset_id/dataRequests
  const root = (teamId, datasetId) => `/team/${teamId}/datasets/${datasetId}/dataRequests`;

  beforeAll(async () => {
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }
    app = await createTestApp();
    const dataRequestRoute = require("../../api/DataRequestRoute.js");
    dataRequestRoute(app);
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
    dataset = await models.Dataset.create({
      name: "Test Dataset",
      team_id: team.id,
    });
    authToken = generateTestToken({ id: user.id, email: user.email });
  });

  // ---- GET /team/:team_id/datasets/:dataset_id/dataRequests ----
  describe("GET /team/:team_id/datasets/:dataset_id/dataRequests", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(root(1, 1));
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-dr-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(root(team.id, dataset.id))
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 and an array when user has access", async () => {
      const res = await request(app)
        .get(root(team.id, dataset.id))
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/dataRequests ----
  describe("POST /team/:team_id/datasets/:dataset_id/dataRequests", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(root(1, 1))
        .send({ dataset_id: 1 });
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-dr-create-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .post(root(team.id, dataset.id))
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ dataset_id: dataset.id });
      expect(res.status).toBe(403);
    });
  });

  // ---- GET /team/:team_id/datasets/:dataset_id/dataRequests/:id ----
  describe("GET /team/:team_id/datasets/:dataset_id/dataRequests/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get(`${root(1, 1)}/1`);
      expect(res.status).toBe(401);
    });
  });

  // ---- PUT /team/:team_id/datasets/:dataset_id/dataRequests/:id ----
  describe("PUT /team/:team_id/datasets/:dataset_id/dataRequests/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put(`${root(1, 1)}/1`)
        .send({ configuration: {} });
      expect(res.status).toBe(401);
    });
  });

  // ---- DELETE /team/:team_id/datasets/:dataset_id/dataRequests/:id ----
  describe("DELETE /team/:team_id/datasets/:dataset_id/dataRequests/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete(`${root(1, 1)}/1`);
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-dr-delete-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .delete(`${root(team.id, dataset.id)}/1`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 with { deleted: true } when deleting an existing dataRequest", async () => {
      const dataRequest = await models.DataRequest.create({ dataset_id: dataset.id });

      const res = await request(app)
        .delete(`${root(team.id, dataset.id)}/${dataRequest.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
    });

    it("should return 404 when the id does not exist", async () => {
      const res = await request(app)
        .delete(`${root(team.id, dataset.id)}/999999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/request ----
  describe("POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/request", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1, 1)}/1/request`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/askAi ----
  describe("POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/askAi", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1, 1)}/1/askAi`)
        .send({ question: "hello" });
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/variableBindings ----
  describe("POST /team/:team_id/datasets/:dataset_id/dataRequests/:id/variableBindings", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`${root(1, 1)}/1/variableBindings`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // eslint-disable-next-line max-len
  // ---- PUT /team/:team_id/datasets/:dataset_id/dataRequests/:id/variableBindings/:variable_id ----

  describe("PUT /team/:team_id/datasets/:dataset_id/dataRequests/:id/variableBindings/:variable_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put(`${root(1, 1)}/1/variableBindings/1`)
        .send({});
      expect(res.status).toBe(401);
    });
  });
});
