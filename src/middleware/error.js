export function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error("[error]", err);
  }
  res.status(status).json({
    error: err.publicMessage || (status >= 500 ? "Internal server error" : err.message),
  });
}
