import dotenv from "dotenv";

dotenv.config();

const required = ["MONGODB_URI", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Warning: ${key} is not set. Using a fallback is unsafe in production.`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "8080", 10),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/zdc",
  jwt: {
    secret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
