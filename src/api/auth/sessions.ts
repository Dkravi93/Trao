import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Collection } from "mongodb";
import type { RevokedAccessTokenDocument, SessionDocument } from "../database.js";

const accessLifetimeSeconds = 60 * 15;
const refreshLifetimeMs = 1000 * 60 * 60 * 24 * 7;
const issuer = "trao-interview-prep";

export interface AccessTokenClaims { sub: string; jti: string; exp: number; }

function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function issueAccessToken(userId: string, secret: string): string {
  return jwt.sign({}, secret, { algorithm: "HS256", subject: userId, issuer, expiresIn: accessLifetimeSeconds, jwtid: randomBytes(16).toString("base64url") });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer });
    if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.jti !== "string" || typeof payload.exp !== "number") return null;
    return { sub: payload.sub, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}

export async function createRefreshSession(sessions: Collection<SessionDocument>, userId: string, secret: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sessions.insertOne({ tokenHash: hashToken(token, secret), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + refreshLifetimeMs) });
  return token;
}

/** Consumes a refresh token once. A concurrent replay fails because the first request deletes it. */
export async function rotateRefreshSession(sessions: Collection<SessionDocument>, token: string | undefined, secret: string): Promise<{ userId: string; token: string } | null> {
  if (!token) return null;
  const session = await sessions.findOneAndDelete({ tokenHash: hashToken(token, secret), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return { userId: session.userId, token: await createRefreshSession(sessions, session.userId, secret) };
}

export async function revokeRefreshSession(sessions: Collection<SessionDocument>, token: string | undefined, secret: string): Promise<void> {
  if (token) await sessions.deleteOne({ tokenHash: hashToken(token, secret) });
}

export async function revokeAccessToken(revokedTokens: Collection<RevokedAccessTokenDocument>, claims: AccessTokenClaims): Promise<void> {
  await revokedTokens.updateOne({ jti: claims.jti }, { $setOnInsert: { jti: claims.jti, expiresAt: new Date(claims.exp * 1000), revokedAt: new Date() } }, { upsert: true });
}

export async function isAccessTokenRevoked(revokedTokens: Collection<RevokedAccessTokenDocument>, jti: string): Promise<boolean> {
  return (await revokedTokens.findOne({ jti })) !== null;
}

export const accessCookie = { name: "trao_access", maxAge: accessLifetimeSeconds * 1000, path: "/" };
export const refreshCookie = { name: "trao_refresh", maxAge: refreshLifetimeMs, path: "/auth" };
