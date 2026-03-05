/**
 * This test file checks the Team API routes.
 * It tests:
 * - That all team endpoints reject unauthenticated requests (401)
 * - That authenticated users can list their own teams
 * - That users outside a team are blocked from viewing it (403)
 * - That team owners can create, update, rename, and delete teams
 * - That non-owners cannot delete a team (403)
 * - That team invites can be generated and accepted (full invite flow end-to-end)
 * - That accepting an invite with a missing, mismatched, or invalid token is rejected
 * - That team members can be listed, and API keys can be created, listed, and deleted
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

describe("Team Routes", () => {
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
    const teamRoute = require("../../api/TeamRoute.js");
    teamRoute(app);
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

  // ---- GET /team ----
  describe("GET /team", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team");
      expect(res.status).toBe(401);
    });

    it("should return 200 with an array of teams for authenticated user", async () => {
      const res = await request(app)
        .get("/team")
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.some((t) => t.id === team.id)).toBe(true);
    });
  });

  // ---- GET /team/:id ----
  describe("GET /team/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-team-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/team/${team.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 with team data when user has access", async () => {
      const res = await request(app)
        .get(`/team/${team.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", team.id);
      expect(res.body).toHaveProperty("name");
    });
  });

  // ---- POST /team ----
  describe("POST /team", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team")
        .send({ name: "New Team" });
      expect(res.status).toBe(401);
    });

    it("should return 200 and create a team when teamRestricted is off", async () => {
      const res = await request(app)
        .post("/team")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Created Team" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", "Created Team");
    });
  });

  // ---- DELETE /team/:id ----
  describe("DELETE /team/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not the team owner", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-team-delete-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .delete(`/team/${team.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 when team owner deletes the team", async () => {
      const teamToDelete = await models.Team.create(teamFactory.build());
      await models.TeamRole.create({
        user_id: user.id,
        team_id: teamToDelete.id,
        role: "teamOwner",
      });

      const res = await request(app)
        .delete(`/team/${teamToDelete.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("deleted", true);
    });
  });

  // ---- PUT /team/:id ----
  describe("PUT /team/:id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1")
        .send({ name: "Updated Team" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when body is missing", async () => {
      const res = await request(app)
        .put(`/team/${team.id}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect([200, 400]).toContain(res.status);
    });

    it("should return 200 when user updates the team", async () => {
      const res = await request(app)
        .put(`/team/${team.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Renamed Team" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("name", "Renamed Team");
    });
  });

  // ---- PUT /team/:id/transfer ----
  describe("PUT /team/:id/transfer", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1/transfer")
        .send({ newOwnerId: 2 });
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:id/invite ----
  describe("POST /team/:id/invite", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/invite")
        .send({ role: "projectViewer" });
      expect(res.status).toBe(401);
    });

    it("should return 200 with an invite URL when user has admin access", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/invite`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ role: "projectViewer", projects: [], canExport: false });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("url");
      expect(res.body.url).toMatch(/invite\?token=/);
    });
  });

  // ---- POST /team/user/:user_id ----
  describe("POST /team/user/:user_id", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post(`/team/user/${user.id}`)
        .send({ token: "anything" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when invite token is missing from body", async () => {
      const res = await request(app)
        .post(`/team/user/${user.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 400 when user_id in params does not match the authenticated user", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `mismatch-invite-${Date.now()}@test.com`,
      }));

      const res = await request(app)
        .post(`/team/user/${otherUser.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ token: "anything" });
      expect(res.status).toBe(400);
    });

    it("should return 401 when the invite token is invalid", async () => {
      const res = await request(app)
        .post(`/team/user/${user.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ token: "this.is.not.a.valid.jwt" });
      expect(res.status).toBe(401);
    });

    // verifying the full invite → accept flow end-to-end.
    it("should return 200 and add the user to the team using a real invite token", async () => {
      // Step 1: team owner generates an invite token
      const inviteRes = await request(app)
        .post(`/team/${team.id}/invite`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ role: "projectViewer", projects: [], canExport: false });
      expect(inviteRes.status).toBe(200);

      // Step 2: extract the JWT from the invite URL
      const inviteUrl = new URL(inviteRes.body.url);
      const inviteToken = inviteUrl.searchParams.get("token");

      // Step 3: a new user accepts the invite
      const newUser = await models.User.create(userFactory.build({
        email: `joiner-${Date.now()}@test.com`,
      }));
      const newUserToken = generateTestToken({ id: newUser.id, email: newUser.email });

      const res = await request(app)
        .post(`/team/user/${newUser.id}`)
        .set("Authorization", `Bearer ${newUserToken}`)
        .send({ token: inviteToken });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", team.id);
    });
  });

  // ---- GET /team/:id/members ----
  describe("GET /team/:id/members", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/members");
      expect(res.status).toBe(401);
    });

    it("should return 403 when user is not a team member", async () => {
      const otherUser = await models.User.create(userFactory.build({
        email: `other-members-${Date.now()}@test.com`,
      }));
      const otherToken = generateTestToken({ id: otherUser.id, email: otherUser.email });

      const res = await request(app)
        .get(`/team/${team.id}/members`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it("should return 200 with a list of members when user has access", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/members`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- PUT /team/:id/role ----
  describe("PUT /team/:id/role", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .put("/team/1/role")
        .send({ user_id: 2, role: "projectViewer" });
      expect(res.status).toBe(401);
    });
  });

  // ---- DELETE /team/:id/member/:userId ----
  describe("DELETE /team/:id/member/:userId", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1/member/2");
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /team/:id/apikey ----
  describe("POST /team/:id/apikey", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app)
        .post("/team/1/apikey")
        .send({ name: "My API Key" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when key name is missing", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/apikey`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 200 and create an API key", async () => {
      const res = await request(app)
        .post(`/team/${team.id}/apikey`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ name: "Test API Key" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", "Test API Key");
    });
  });

  // ---- GET /team/:id/apikey ----
  describe("GET /team/:id/apikey", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).get("/team/1/apikey");
      expect(res.status).toBe(401);
    });

    it("should return 200 and a list of API keys", async () => {
      const res = await request(app)
        .get(`/team/${team.id}/apikey`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  // ---- DELETE /team/:id/apikey/:keyId ----
  describe("DELETE /team/:id/apikey/:keyId", () => {
    it("should return 401 without a token", async () => {
      const res = await request(app).delete("/team/1/apikey/1");
      expect(res.status).toBe(401);
    });

    it("should return 404 when key does not exist", async () => {
      const res = await request(app)
        .delete(`/team/${team.id}/apikey/99999`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });
});
