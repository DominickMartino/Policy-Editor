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
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });

  const recordKey = `policy:${userId}:${id}`;
  const indexKey = `policies:index:${userId}`;

  try {
    if (req.method === "GET") {
      const raw = await kv.get(recordKey);
      if (!raw) return res.status(404).json({ error: "Not found" });
      return res.status(200).json(JSON.parse(raw));
    }

    if (req.method === "PUT") {
      const raw = await kv.get(recordKey);
      if (!raw) return res.status(404).json({ error: "Not found" });
      const existing = JSON.parse(raw);

      const { document, messages, title, versionSnapshot } = req.body || {};

      let versions = existing.versions || [];
      if (versionSnapshot && versionSnapshot.document) {
        versions = [
          ...versions,
          {
            id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            document: versionSnapshot.document,
            label: versionSnapshot.label || "Edit",
            savedAt: Date.now(),
          },
        ].slice(-20); // keep the most recent 20 versions
      }

      const updated = {
        ...existing,
        document: document ?? existing.document,
        messages: messages ?? existing.messages,
        title: title ?? existing.title,
        versions,
        updatedAt: Date.now(),
      };
      await kv.set(recordKey, JSON.stringify(updated));
      return res.status(200).json(updated);
    }

    if (req.method === "DELETE") {
      await kv.del(recordKey);
      const idsRaw = await kv.get(indexKey);
      const ids = idsRaw ? JSON.parse(idsRaw) : [];
      await kv.set(indexKey, JSON.stringify(ids.filter((x) => x !== id)));
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("policy handler error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
