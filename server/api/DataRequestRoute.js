const rateLimit = require("express-rate-limit");

const DataRequestController = require("../controllers/DataRequestController");
const verifyToken = require("../modules/verifyToken");
const DatasetController = require("../controllers/DatasetController");
const ConnectionController = require("../controllers/ConnectionController");
const {
  createPermissionMiddleware,
} = require("../middlewares/checkPermissions");

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max,
  });
};

module.exports = (app) => {
  const dataRequestController = new DataRequestController();
  const datasetController = new DatasetController();
  const connectionController = new ConnectionController();

  const root = "/team/:team_id/datasets/:dataset_id/dataRequests";

  const checkPermissions = createPermissionMiddleware("dataRequest", {
    validateAdminScope: async (req, teamRole) => {
      if (req?.body?.connection_id) {
        const connection = await connectionController.findById(
          req.body.connection_id,
        );
        if (connection.team_id !== teamRole.team_id) {
          return { ok: false, status: 403, message: "Access denied" };
        }
      }
      if (req?.body?.dataset_id) {
        const dataset = await datasetController.findById(req.body.dataset_id);
        if (dataset.team_id !== teamRole.team_id) {
          return { ok: false, status: 403, message: "Access denied" };
        }
      }
      return { ok: true };
    },
    validateProjectScope: async (req, teamRole) => {
      const datasets = await datasetController.findByProjects(
        req.params.team_id,
        teamRole.projects,
      );
      if (!datasets?.length) {
        return { ok: false, status: 404, message: "No datasets found" };
      }
      if (req?.body?.connection_id) {
        const connections = await connectionController.findByProjects(
          req.params.team_id,
          teamRole.projects,
        );
        if (!connections?.length) {
          return { ok: false, status: 404, message: "No connections found" };
        }
      }
      return { ok: true };
    },
  })("readOwn"); // <-- bound to a fixed actionType, giving a direct middleware
  /*
   ** Route to create a new Data request
   */
  app.post(`${root}`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .create(req.body)
      .then((dataRequest) => {
        return res.status(200).send(dataRequest);
      })
      .catch((error) => {
        if (error.message === "401") {
          return res.status(401).send({ error: "Not authorized" });
        }

        return res.status(400).send(error);
      });
  });
  // -------------------------------------------------

  /*
   ** Route to get a Data Request by dataset ID
   */
  app.get(`${root}`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .findByDataset(req.params.dataset_id)
      .then((dataRequests) => {
        return res.status(200).send(dataRequests);
      })
      .catch((error) => {
        if (error && error.message === "404") {
          return res.status(404).send(error);
        }

        return res.status(400).send(error);
      });
  });
  // -------------------------------------------------

  /*
   ** Route to get Data request by ID
   */
  app.get(`${root}/:id`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .findById(req.params.id)
      .then((dataRequest) => {
        return res.status(200).send(dataRequest);
      })
      .catch((error) => {
        if (error.message === "401") {
          return res.status(401).send({ error: "Not authorized" });
        }

        return res.status(400).send(error);
      });
  });
  // -------------------------------------------------

  /*
   ** Route to update the dataRequest
   */
  app.put(`${root}/:id`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .update(req.params.id, req.body)
      .then((dataRequest) => {
        return res.status(200).send(dataRequest);
      })
      .catch((error) => {
        if (error.message === "401") {
          return res.status(401).send({ error: "Not authorized" });
        }

        return res.status(400).send(error);
      });
  });
  // -------------------------------------------------

  /*
   ** Route to delete a Data Request by ID
   */
  app.delete(`${root}/:id`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .delete(req.params.id)
      .then((dataRequest) => {
        return res.status(200).send(dataRequest);
      })
      .catch((error) => {
        if (error.message === "404") {
          return res.status(404).send({ error: "DataRequest not found" });
        }
        if (error.message === "401") {
          return res.status(401).send({ error: "Not authorized" });
        }

        return res.status(400).send(error);
      });
  });
  // -------------------------------------------------

  /*
   ** Route to run a request
   */
  app.post(`${root}/:id/request`, verifyToken, checkPermissions, (req, res) => {
    return dataRequestController
      .runRequest({
        id: req.params.id,
        chart_id: req.params.chart_id,
        noSource: req.body.noSource,
        getCache: req.body.getCache,
        filters: req.body.filters,
        variables: req.body.variables,
      })
      .then((dataRequest) => {
        const newDataRequest = dataRequest;
        // reduce the size of the returned data. No point in showing thousands of objects
        if (newDataRequest?.dataRequest?.responseData?.data) {
          const { data } = newDataRequest.dataRequest.responseData;
          if (typeof data === "object" && data instanceof Array) {
            newDataRequest.dataRequest.responseData.data = data.slice(0, 20);
          } else if (typeof data === "object") {
            const resultsKey = [];
            Object.keys(data).forEach((key) => {
              if (data[key] instanceof Array) {
                resultsKey.push(key);
              }
            });

            if (resultsKey.length > 0) {
              resultsKey.forEach((resultKey) => {
                const slicedArray = data[resultKey].slice(0, 20);
                newDataRequest.dataRequest.responseData.data[resultKey] = slicedArray;
              });
            }
          }
        }
        return res.status(200).send(newDataRequest);
      })
      .catch((error) => {
        if (error.message === "401") {
          return res.status(401).send({ error: "Not authorized" });
        }
        return res.status(400).json({ error: error.message });
      });
  });
  // -------------------------------------------------

  /*
   ** Route to ask AI a question
   */
  app.post(
    `${root}/:id/askAi`,
    verifyToken,
    checkPermissions,
    apiLimiter(10),
    (req, res) => {
      return dataRequestController
        .askAi(
          req.params.id,
          req.body.question,
          req.body.conversationHistory,
          req.body.currentQuery,
        )
        .then((aiResponse) => {
          return res.status(200).send(aiResponse);
        })
        .catch((error) => {
          return res.status(400).send(error);
        });
    },
  );
  // -------------------------------------------------

  /*
   ** Route to create a new variable binding
   */
  app.post(
    `${root}/:id/variableBindings`,
    verifyToken,
    checkPermissions,
    (req, res) => {
      return dataRequestController
        .createVariableBinding(req.params.id, req.body)
        .then((variableBinding) => {
          return res.status(200).send(variableBinding);
        })
        .catch((error) => res.status(400).json({ error: error.message }));
    },
  );
  // -------------------------------------------------

  /*
   ** Route to update a variable binding
   */
  app.put(
    `${root}/:id/variableBindings/:variable_id`,
    verifyToken,
    checkPermissions,
    (req, res) => {
      return dataRequestController
        .updateVariableBinding(req.params.id, req.params.variable_id, req.body)
        .then((variableBinding) => {
          return res.status(200).send(variableBinding);
        })
        .catch((error) => res.status(400).json({ error: error.message }));
    },
  );
  // -------------------------------------------------

  return (req, res, next) => {
    next();
  };
};
