import Redis from "ioredis";
import { requireUserId } from "../lib/auth.js";

let redis;
function getClient() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      connectTimeout: 8000,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on("error", (e) => console.error("Redis client error:", e.message));
  }
  return redis;
}

export default async function handler(req, res) {
  const userId = await requireUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in" });

  const kv = getClient();
  const indexKey = `policies:index:${userId}`;

  try {
    if (req.method === "GET") {
      const idsRaw = await kv.get(indexKey);
      const ids = idsRaw ? JSON.parse(idsRaw) : [];
      if (ids.length === 0) return res.status(200).json({ policies: [] });

      const raws = await Promise.all(ids.map((id) => kv.get(`policy:${userId}:${id}`)));
      const policies = raws
        .filter(Boolean)
        .map((r) => JSON.parse(r))
        .map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return res.status(200).json({ policies });
    }

    if (req.method === "POST") {
      const { title, document, messages } = req.body || {};
      if (!document) return res.status(400).json({ error: "Missing document" });

      const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const record = {
        id,
        title: title?.trim() || "Untitled policy",
        document,
        messages: messages || [],
        versions: [],
        updatedAt: Date.now(),
      };

      await kv.set(`policy:${userId}:${id}`, JSON.stringify(record));
      const idsRaw = await kv.get(indexKey);
      const ids = idsRaw ? JSON.parse(idsRaw) : [];
      await kv.set(indexKey, JSON.stringify([...ids, id]));

      return res.status(200).json({ id });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("policies handler error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
