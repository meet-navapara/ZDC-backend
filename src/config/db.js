import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB() {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("[db] MongoDB connected");
  } catch (err) {
    console.error("[db] MongoDB connection error:", err.message);
    throw err;
  }

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB disconnected");
  });
}
