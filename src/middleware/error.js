export function notFound(req, res) {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
}

// Maps well-known error shapes (Multer uploads, JSON body parsing) to clean
// 4xx responses so client mistakes never surface as opaque 500s.
function classify(err) {
  // Multer errors (file too large, too many files, unexpected field, etc.).
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return { status: 413, message: "File too large. Maximum size is 10 MB." };
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return { status: 400, message: "Too many files or unexpected upload field." };
    }
    return { status: 400, message: err.message };
  }
  // Our upload fileFilter rejects unsupported types with a plain Error.
  if (/Only PNG, JPG, or WEBP images are allowed/.test(err.message || "")) {
    return { status: 400, message: err.message };
  }
  // Malformed JSON body from express.json().
  if (err.type === "entity.parse.failed") {
    return { status: 400, message: "Invalid JSON in request body." };
  }
  if (err.type === "entity.too.large") {
    return { status: 413, message: "Request body too large." };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const mapped = classify(err);
  if (mapped) {
    return res.status(mapped.status).json({ error: mapped.message });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error("[error]", err);
  }
  return res.status(status).json({
    error: err.publicMessage || (status >= 500 ? "Internal server error" : err.message),
  });
}
