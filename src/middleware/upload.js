import multer from "multer";

// Keep uploaded files in memory only; they are streamed to Cloudinary and
// never written to the server's local disk.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PNG, JPG, or WEBP images are allowed"));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
});
