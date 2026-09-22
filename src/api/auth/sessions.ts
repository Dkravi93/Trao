import { createHmac, randomBytes } from "node:crypto";
import type { Collection } from "mongodb";
import type { SessionDocument } from "../database.js";

const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function createSession(sessions: Collection<SessionDocument>, userId: string, secret: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sessions.insertOne({ tokenHash: hashToken(token, secret), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + sessionLifetimeMs) });
  return token;
}

export async function userIdFromSession(sessions: Collection<SessionDocument>, token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const session = await sessions.findOne({ tokenHash: hashToken(token, secret), expiresAt: { $gt: new Date() } });
  return session?.userId ?? null;
}

export async function revokeSession(sessions: Collection<SessionDocument>, token: string | undefined, secret: string): Promise<void> {
  if (token) await sessions.deleteOne({ tokenHash: hashToken(token, secret) });
}

export const sessionCookie = { name: "trao_session", maxAge: sessionLifetimeMs };
