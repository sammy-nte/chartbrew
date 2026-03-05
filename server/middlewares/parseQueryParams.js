const paramsToParse = ["project_id", "team_id", "user_id", "dataset_id", "dataRequest_id"];

const parseQueryParams = (req, res, next) => {
  // Snapshot req.query into a plain object — Express defines req.query as a
  // prototype getter that re-parses the URL on every access, so mutations on
  // the returned object are silently discarded. By snapshotting and then
  // redefining req.query as an own property we make the integer conversions stick.
  const query = { ...req.query };

  const hasInvalidParam = paramsToParse.some((param) => {
    if (param in query) {
      const parsed = parseInt(query[param], 10);

      if (Number.isNaN(parsed) || !Number.isInteger(parsed)) {
        res.status(400).json({ message: `Invalid ${param}` });
        return true;
      }

      query[param] = parsed;
    }
    return false;
  });

  if (!hasInvalidParam) {
    // Shadow the prototype getter with an own plain-value property so that
    // downstream handlers see the integer-coerced values.
    Object.defineProperty(req, "query", {
      value: query,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  }
};

module.exports = parseQueryParams;
