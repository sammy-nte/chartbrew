const TeamController = require("../controllers/TeamController");
const accessControl = require("../modules/accessControl");

const teamController = new TeamController();

const createPermissionMiddleware = (entity, opts = {}) => {
  const {
    getTeamId = (req) => req.params.team_id,
    onGranted,
    validateAdminScope,
    validateProjectScope,
    transformActionType,
  } = opts;

  return (actionType = "readOwn") => {
    return async (req, res, next) => {
      try {
        const teamId = await getTeamId(req);

        const teamRole = await teamController.getTeamRole(teamId, req.user.id);
        if (!teamRole?.role) {
          return res.status(403).json({ message: "Access denied" });
        }

        const resolvedActionType = transformActionType
          ? transformActionType(actionType, teamRole)
          : actionType;

        const permission = accessControl.can(teamRole.role)[resolvedActionType](entity);
        if (!permission.granted) {
          return res.status(403).json({ message: "Access denied" });
        }

        if (["teamOwner", "teamAdmin"].includes(teamRole.role)) {
          if (validateAdminScope) {
            const result = await validateAdminScope(req, teamRole);
            if (!result.ok) {
              return res
                .status(result.status || 403)
                .json({ message: result.message || "Access denied" });
            }
          }
          if (onGranted) await onGranted(req, teamRole, permission);
          return next();
        }

        if (teamRole.projects?.length > 0) {
          if (validateProjectScope) {
            const result = await validateProjectScope(req, teamRole);
            if (!result.ok) {
              return res.status(result.status || 403).json({ message: result.message || "Access denied" });
            }
          }

          req.user.projects = teamRole.projects;
          if (onGranted) await onGranted(req, teamRole, permission);
          return next();
        }

        return res.status(403).json({ message: "Access denied" });
      } catch (err) {
        const status = err.status || 500;
        const message = status < 500 ? err.message : "Internal server error";
        return res.status(status).json({ message });
      }
    };
  };
};

module.exports = { createPermissionMiddleware };
