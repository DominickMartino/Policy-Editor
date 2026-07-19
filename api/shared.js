import Redis from "ioredis";

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

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const kv = getClient();
  try {
    const mapRaw = await kv.get(`share:${token}`);
    if (!mapRaw) return res.status(404).json({ error: "This link isn't valid or has been revoked." });

    const { userId, id } = JSON.parse(mapRaw);
    const raw = await kv.get(`policy:${userId}:${id}`);
    if (!raw) return res.status(404).json({ error: "This policy no longer exists." });

    const record = JSON.parse(raw);
    // Only ever expose the title and document text — never messages, versions, or internal IDs.
    return res.status(200).json({ title: record.title, document: record.document });
  } catch (e) {
    console.error("shared handler error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
