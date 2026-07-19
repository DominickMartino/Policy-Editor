import Stripe from "stripe";
import Redis from "ioredis";
import { requireUserId } from "../lib/auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const userId = await requireUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in" });

  const kv = getClient();
  try {
    const raw = await kv.get(`subscription:${userId}`);
    const subscription = raw ? JSON.parse(raw) : null;
    if (!subscription?.customerId) {
      return res.status(400).json({ error: "No billing account found for this user" });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.customerId,
      return_url: origin,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Portal session error:", e);
    return res.status(500).json({ error: "Could not open billing portal" });
  }
}
