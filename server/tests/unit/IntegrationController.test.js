/**
 * This test file checks how the IntegrationController manages third-party
 * integrations (like Slack or webhooks) for a team.
 *
 * It tests:
 * - Looking up an integration by ID (with or without a team filter)
 * - Getting all integrations belonging to a team
 * - Creating a new integration
 * - Updating an integration and returning the refreshed record
 * - Deleting an integration and its linked alert integrations
 * - Returning 404 errors when an integration is not found or already deleted
 *
 * All database calls are intercepted using spies so no real database is needed.
 */
import {
  describe, it, expect, vi, afterEach
} from "vitest";

const db = require("../../models/models");
const IntegrationController = require("../../controllers/IntegrationController");

const makeIntegration = (overrides = {}) => ({
  id: 1,
  team_id: 10,
  name: "Slack Workspace",
  type: "slack",
  config: {},
  ...overrides,
});

describe("IntegrationController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── findById ──────────────────────────────────────────────────────────────

  describe("findById()", () => {
    it("uses findByPk when no teamId is supplied", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(integration);
      vi.spyOn(db.Integration, "findOne");

      const result = await IntegrationController.findById(1);

      expect(db.Integration.findByPk).toHaveBeenCalledWith(1);
      expect(db.Integration.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(integration);
    });

    it("uses findOne scoped to the team when teamId is supplied", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "findOne").mockResolvedValue(integration);
      vi.spyOn(db.Integration, "findByPk");

      const result = await IntegrationController.findById(1, 10);

      expect(db.Integration.findOne).toHaveBeenCalledWith({
        where: { id: 1, team_id: 10 },
      });
      expect(db.Integration.findByPk).not.toHaveBeenCalled();
      expect(result).toEqual(integration);
    });

    it("returns null when the integration does not exist", async () => {
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(null);

      const result = await IntegrationController.findById(999);

      expect(result).toBeNull();
    });
  });

  // ─── findByTeam ────────────────────────────────────────────────────────────

  describe("findByTeam()", () => {
    it("returns all integrations belonging to a team", async () => {
      const integrations = [makeIntegration(), makeIntegration({ id: 2 })];
      vi.spyOn(db.Integration, "findAll").mockResolvedValue(integrations);

      const result = await IntegrationController.findByTeam(10);

      expect(db.Integration.findAll).toHaveBeenCalledWith({
        where: { team_id: 10 },
      });
      expect(result).toHaveLength(2);
    });

    it("returns an empty array when the team has no integrations", async () => {
      vi.spyOn(db.Integration, "findAll").mockResolvedValue([]);

      const result = await IntegrationController.findByTeam(99);

      expect(result).toEqual([]);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe("update()", () => {
    it("updates the row and returns the refreshed integration", async () => {
      const updated = makeIntegration({ name: "New Name" });
      vi.spyOn(db.Integration, "update").mockResolvedValue([1]);
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(updated);

      const result = await IntegrationController.update(1, { name: "New Name" });

      expect(db.Integration.update).toHaveBeenCalledWith(
        { name: "New Name" },
        { where: { id: 1 } }
      );
      expect(result).toEqual(updated);
    });

    it("scopes the update where-clause to the team when teamId is provided", async () => {
      const updated = makeIntegration({ name: "Team update" });
      vi.spyOn(db.Integration, "update").mockResolvedValue([1]);
      vi.spyOn(db.Integration, "findOne").mockResolvedValue(updated);

      await IntegrationController.update(1, { name: "Team update" }, 10);

      expect(db.Integration.update).toHaveBeenCalledWith(
        { name: "Team update" },
        { where: { id: 1, team_id: 10 } }
      );
    });

    it("rejects with a 404 error when no rows are updated", async () => {
      vi.spyOn(db.Integration, "update").mockResolvedValue([0]);

      await expect(
        IntegrationController.update(999, { name: "Ghost" })
      ).rejects.toThrow("404");
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates and returns a new integration", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "create").mockResolvedValue(integration);

      const result = await IntegrationController.create({
        team_id: 10,
        name: "Slack Workspace",
        type: "slack",
      });

      expect(db.Integration.create).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: 10, name: "Slack Workspace" })
      );
      expect(result).toEqual(integration);
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe("remove()", () => {
    it("destroys the integration and cascades to AlertIntegrations", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(integration);
      vi.spyOn(db.Integration, "destroy").mockResolvedValue(1);
      vi.spyOn(db.AlertIntegration, "destroy").mockResolvedValue(2);

      await IntegrationController.remove(1);

      expect(db.Integration.destroy).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(db.AlertIntegration.destroy).toHaveBeenCalledWith({
        where: { integration_id: 1 },
      });
    });

    it("scopes the destroy where-clause to the team when teamId is provided", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "findOne").mockResolvedValue(integration);
      vi.spyOn(db.Integration, "destroy").mockResolvedValue(1);
      vi.spyOn(db.AlertIntegration, "destroy").mockResolvedValue(0);

      await IntegrationController.remove(1, 10);

      expect(db.Integration.destroy).toHaveBeenCalledWith({
        where: { id: 1, team_id: 10 },
      });
    });

    it("rejects with 404 when the integration is not found", async () => {
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(null);

      await expect(IntegrationController.remove(999)).rejects.toThrow("404");
    });

    it("rejects with 404 when destroy reports zero deleted rows (race condition)", async () => {
      const integration = makeIntegration();
      vi.spyOn(db.Integration, "findByPk").mockResolvedValue(integration);
      vi.spyOn(db.Integration, "destroy").mockResolvedValue(0);

      await expect(IntegrationController.remove(1)).rejects.toThrow("404");
    });
  });
});
