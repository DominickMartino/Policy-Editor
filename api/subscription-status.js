import Redis from "ioredis";
import { requireUserId } from "../lib/auth.js";

let redis;
function getClient() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 8000,
      retryStrategy: (times) => Math.min(times * 200, 2000), // retry with backoff instead of giving up
    });
    redis.on("error", (e) => {
      console.error("Redis client error:", e.message);
      // If the connection is truly dead, drop the cached client so the next
      // request builds a fresh one instead of reusing a broken connection.
      if (e.message.includes("closed") || e.message.includes("ECONNRESET")) {
        redis = null;
      }
    });
  }
  return redis;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await requireUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in" });

  const kv = getClient();
  try {
    const raw = await kv.get(`subscription:${userId}`);
    const subscription = raw ? JSON.parse(raw) : null;
    return res.status(200).json({ active: subscription?.status === "active", subscription });
  } catch (e) {
    console.error("subscription-status error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
