// Simple error handler for local testing
module.exports = function errorHandler(err, req, res, next) {
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err && err.message ? err.message : String(err) });
};
