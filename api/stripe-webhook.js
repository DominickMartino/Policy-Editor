import Stripe from "stripe";
import Redis from "ioredis";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe needs the raw, unparsed request body to verify the webhook signature,
// so we turn off Vercel's automatic JSON body parsing for this one route.
export const config = { api: { bodyParser: false } };

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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature verification failed:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  const kv = getClient();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (userId) {
        await kv.set(
          `subscription:${userId}`,
          JSON.stringify({
            status: "active",
            customerId: session.customer,
            subscriptionId: session.subscription,
            updatedAt: Date.now(),
          })
        );
        // Remember which app-user a given Stripe customer belongs to, so future
        // subscription events (which only include the Stripe customer ID) can
        // be matched back to the right account.
        if (session.customer) {
          await kv.set(`stripeCustomer:${session.customer}`, userId);
        }
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userId = await kv.get(`stripeCustomer:${sub.customer}`);
      if (userId) {
        const isActive = sub.status === "active" || sub.status === "trialing";
        await kv.set(
          `subscription:${userId}`,
          JSON.stringify({
            status: isActive ? "active" : "inactive",
            customerId: sub.customer,
            subscriptionId: sub.id,
            updatedAt: Date.now(),
          })
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
