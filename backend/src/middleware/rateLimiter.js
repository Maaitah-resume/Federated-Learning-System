// Minimal rate limiter stubs for local testing
function allowAll(req, res, next) {
  return next();
}

const apiLimiter = allowAll;
const loginLimiter = allowAll;

module.exports = { apiLimiter, loginLimiter };
