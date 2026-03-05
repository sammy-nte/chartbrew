/**
 * This test file checks the permission middleware that decides whether a user
 * is allowed to perform an action on a resource.
 *
 * It tests:
 * - Blocking users who are not members of a team (returns 403)
 * - Blocking users with an incomplete role object (returns 403)
 * - Allowing team owners and admins to pass through
 * - Running optional custom validation for admin and project-scoped roles
 * - Blocking project-scoped roles when they have no assigned projects
 * - Supporting custom functions to extract the team ID from a request
 * - Transforming the action type before checking permissions
 * - Returning 500 when something unexpected goes wrong
 *
 * The real role and permission rules are used — they are not mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TeamController = require("../../controllers/TeamController");
const { createPermissionMiddleware } = require("../../middlewares/checkPermissions");

// ── helpers ───────────────────────────────────────────────────────────────────

const makeReq = (overrides = {}) => ({
  params: { team_id: "1" },
  body: {},
  user: { id: 42 },
  ...overrides,
});

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// ── role fixtures ─────────────────────────────────────────────────────────────

const adminTeamRole = (role = "teamOwner") => ({ role, team_id: 1, projects: [] });
const projectTeamRole = (role = "projectAdmin", projects = [1]) => ({
  role, team_id: 1, projects,
});

// ─────────────────────────────────────────────────────────────────────────────

describe("createPermissionMiddleware", () => {
  let getTeamRole;

  beforeEach(() => {
    getTeamRole = vi.spyOn(TeamController.prototype, "getTeamRole");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Team role fetching ─────────────────────────────────────────────────

  describe("team role fetching", () => {
    it("returns 403 when getTeamRole returns null (user not on team)", async () => {
      getTeamRole.mockResolvedValue(null);
      const mw = createPermissionMiddleware("dataset")();
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when teamRole exists but has no role property", async () => {
      getTeamRole.mockResolvedValue({ team_id: 1 });
      const mw = createPermissionMiddleware("dataset")();
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("uses req.params.team_id by default to look up the role", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole());
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const req = makeReq({ params: { team_id: "99" } });

      await mw(req, makeRes(), vi.fn());

      expect(getTeamRole).toHaveBeenCalledWith("99", 42);
    });
  });

  // ── 2. accessControl permission check ────────────────────────────────────

  describe("accessControl permission check", () => {
    it("returns 403 when the role does not have the requested permission", async () => {
      // projectViewer has read:own on dataset but not create:own
      getTeamRole.mockResolvedValue(projectTeamRole("projectViewer", [1]));
      const mw = createPermissionMiddleware("dataset")("createOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── 3. Admin branch (teamOwner / teamAdmin) ───────────────────────────────

  describe("admin branch", () => {
    it("calls next() for teamOwner with a valid permission", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const next = vi.fn();

      await mw(makeReq(), makeRes(), next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("calls next() for teamAdmin with a valid permission", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamAdmin"));
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const next = vi.fn();

      await mw(makeReq(), makeRes(), next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("calls validateAdminScope and proceeds when it returns { ok: true }", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const validateAdminScope = vi.fn().mockResolvedValue({ ok: true });
      const mw = createPermissionMiddleware("dataset", { validateAdminScope })("readOwn");
      const next = vi.fn();

      await mw(makeReq(), makeRes(), next);

      expect(validateAdminScope).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledOnce();
    });

    it("returns the correct status when validateAdminScope returns { ok: false }", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const validateAdminScope = vi.fn().mockResolvedValue({
        ok: false, status: 403, message: "Connection belongs to another team",
      });
      const mw = createPermissionMiddleware("dataset", { validateAdminScope })("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "Connection belongs to another team" });
      expect(next).not.toHaveBeenCalled();
    });

    it("does NOT call validateProjectScope for admin roles", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const validateProjectScope = vi.fn().mockResolvedValue({ ok: true });
      const mw = createPermissionMiddleware("dataset", { validateProjectScope })("readOwn");

      await mw(makeReq(), makeRes(), vi.fn());

      expect(validateProjectScope).not.toHaveBeenCalled();
    });

    it("calls onGranted with req, teamRole, and the permission object", async () => {
      const teamRole = adminTeamRole("teamOwner");
      getTeamRole.mockResolvedValue(teamRole);
      const onGranted = vi.fn();
      const mw = createPermissionMiddleware("dataset", { onGranted })("readOwn");

      await mw(makeReq(), makeRes(), vi.fn());

      expect(onGranted).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: 42 }) }),
        teamRole,
        expect.any(Object),
      );
    });

    it("side-effects from onGranted are visible on req.user", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const onGranted = (req, teamRole) => { req.user.isEditor = true; };
      const mw = createPermissionMiddleware("dataset", { onGranted })("readOwn");
      const req = makeReq();

      await mw(req, makeRes(), vi.fn());

      expect(req.user.isEditor).toBe(true);
    });
  });

  // ── 4. Project-scoped branch ──────────────────────────────────────────────

  describe("project-scoped branch", () => {
    it("calls next() and sets req.user.projects for projectAdmin with assigned projects", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", [5, 6]));
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const req = makeReq();
      const next = vi.fn();

      await mw(req, makeRes(), next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.user.projects).toEqual([5, 6]);
    });

    it("returns 403 when a project-scoped role has an empty projects array", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", []));
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("calls validateProjectScope and proceeds when it returns { ok: true }", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", [1]));
      const validateProjectScope = vi.fn().mockResolvedValue({ ok: true });
      const mw = createPermissionMiddleware("dataset", { validateProjectScope })("readOwn");
      const next = vi.fn();

      await mw(makeReq(), makeRes(), next);

      expect(validateProjectScope).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledOnce();
    });

    it("returns 404 when validateProjectScope returns { ok: false, status: 404 }", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", [1]));
      const validateProjectScope = vi.fn().mockResolvedValue({
        ok: false, status: 404, message: "No datasets found",
      });
      const mw = createPermissionMiddleware("dataset", { validateProjectScope })("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "No datasets found" });
      expect(next).not.toHaveBeenCalled();
    });

    it("does NOT call validateAdminScope for project-scoped roles", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", [1]));
      const validateAdminScope = vi.fn().mockResolvedValue({ ok: true });
      const mw = createPermissionMiddleware("dataset", { validateAdminScope })("readOwn");

      await mw(makeReq(), makeRes(), vi.fn());

      expect(validateAdminScope).not.toHaveBeenCalled();
    });

    it("calls onGranted for project-scoped roles too", async () => {
      const teamRole = projectTeamRole("projectAdmin", [1]);
      getTeamRole.mockResolvedValue(teamRole);
      const onGranted = vi.fn();
      const mw = createPermissionMiddleware("dataset", { onGranted })("readOwn");

      await mw(makeReq(), makeRes(), vi.fn());

      // req.user.projects is set before onGranted is called, so use objectContaining
      expect(onGranted).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: 42 }) }),
        teamRole,
        expect.any(Object),
      );
    });
  });

  // ── 5. Options ────────────────────────────────────────────────────────────

  describe("options", () => {
    it("uses a custom synchronous getTeamId to extract team_id", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const getTeamId = (req) => req.params.id;
      const mw = createPermissionMiddleware("dataset", { getTeamId })("readOwn");
      const req = makeReq({ params: { id: "77" } });

      await mw(req, makeRes(), vi.fn());

      expect(getTeamRole).toHaveBeenCalledWith("77", 42);
    });

    it("supports an async getTeamId function", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const getTeamId = vi.fn().mockResolvedValue("async-55");
      const mw = createPermissionMiddleware("dataset", { getTeamId })("readOwn");

      await mw(makeReq(), makeRes(), vi.fn());

      expect(getTeamRole).toHaveBeenCalledWith("async-55", 42);
    });

    it("returns the error status when async getTeamId throws with a .status property", async () => {
      const err = Object.assign(new Error("Project not found"), { status: 404 });
      const getTeamId = vi.fn().mockRejectedValue(err);
      const mw = createPermissionMiddleware("dataset", { getTeamId })("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "Project not found" });
      expect(next).not.toHaveBeenCalled();
    });

    it("applies transformActionType before the accessControl check", async () => {
      // projectViewer cannot createOwn dataset — transform to readOwn (which is allowed)
      getTeamRole.mockResolvedValue(projectTeamRole("projectViewer", [1]));
      const transformActionType = vi.fn().mockReturnValue("readOwn");
      const mw = createPermissionMiddleware("dataset", { transformActionType })("createOwn");
      const next = vi.fn();

      await mw(makeReq(), makeRes(), next);

      expect(transformActionType).toHaveBeenCalledWith(
        "createOwn",
        expect.objectContaining({ role: "projectViewer" }),
      );
      expect(next).toHaveBeenCalledOnce();
    });
  });

  // ── 6. Error handling ─────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when getTeamRole throws an unexpected error", async () => {
      getTeamRole.mockRejectedValue(new Error("DB connection failed"));
      const mw = createPermissionMiddleware("dataset")("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Internal server error" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 500 when validateAdminScope throws unexpectedly", async () => {
      getTeamRole.mockResolvedValue(adminTeamRole("teamOwner"));
      const validateAdminScope = vi.fn().mockRejectedValue(new Error("unexpected"));
      const mw = createPermissionMiddleware("dataset", { validateAdminScope })("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 500 when validateProjectScope throws unexpectedly", async () => {
      getTeamRole.mockResolvedValue(projectTeamRole("projectAdmin", [1]));
      const validateProjectScope = vi.fn().mockRejectedValue(new Error("unexpected"));
      const mw = createPermissionMiddleware("dataset", { validateProjectScope })("readOwn");
      const res = makeRes();
      const next = vi.fn();

      await mw(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
