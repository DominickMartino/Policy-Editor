import { verifyToken } from "@clerk/backend";

// Reads the "Authorization: Bearer <token>" header, verifies it against
// Clerk, and returns the signed-in user's unique ID — or null if the
// request isn't properly authenticated.
export async function requireUserId(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload.sub || null;
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return null;
  }
}
