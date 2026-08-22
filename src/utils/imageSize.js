/** Perfect Corp / YouCam minimum width and height for source images. */
export const MIN_TRYON_IMAGE_PX = 321;

export function needsUpscale(width, height, min = MIN_TRYON_IMAGE_PX) {
  return !width || !height || width <= min || height <= min;
}

export function upscaleDimensions(width, height, min = MIN_TRYON_IMAGE_PX) {
  if (!needsUpscale(width, height, min)) {
    return { width, height };
  }
  const scale = Math.max(min / width, min / height);
  return {
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
  };
}

/** Map provider errors to user-friendly copy. */
export function friendlyTryOnError(message) {
  if (!message) return "Rendering failed. Please try again.";
  const lower = message.toLowerCase();
  if (lower.includes("320px") || lower.includes("width and height")) {
    return "One of the photos is too small. Use images at least 321×321 pixels (customer photo and product image).";
  }
  if (lower.includes("publicly accessible") || lower.includes("cloudinary")) {
    return "Images must be stored on Cloudinary so the render service can access them. Check backend storage settings.";
  }
  if (lower.includes("not configured") || lower.includes("api_key")) {
    return "Try-on service is not configured on the server. Contact support.";
  }
  return message;
}
