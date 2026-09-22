import assert from "node:assert/strict";
import test from "node:test";
import type { Collection } from "mongodb";
import type { RevokedAccessTokenDocument, SessionDocument } from "../database.js";
import { createRefreshSession, isAccessTokenRevoked, issueAccessToken, revokeAccessToken, rotateRefreshSession, verifyAccessToken } from "./sessions.js";

const secret = "a-test-only-secret-that-is-longer-than-thirty-two-characters";

test("issues signed, expiring access JWTs and tracks revocation on logout", async () => {
  const token = issueAccessToken("user-123", secret);
  const claims = verifyAccessToken(token, secret);
  assert.equal(claims?.sub, "user-123");
  assert.equal(verifyAccessToken(token, "another-secret-that-is-also-longer-than-thirty-two-chars"), null);

  const revoked = new Map<string, RevokedAccessTokenDocument>();
  const collection = {
    updateOne: async (_filter: unknown, update: { $setOnInsert: RevokedAccessTokenDocument }) => {
      revoked.set(update.$setOnInsert.jti, update.$setOnInsert);
    },
    findOne: async (filter: { jti: string }) => revoked.get(filter.jti) ?? null,
  } as unknown as Collection<RevokedAccessTokenDocument>;
  if (!claims) throw new Error("Expected valid access claims.");
  await revokeAccessToken(collection, claims);
  assert.equal(await isAccessTokenRevoked(collection, claims.jti), true);
});

test("rotates a refresh token once, preventing replay", async () => {
  const tokens = new Map<string, SessionDocument>();
  const collection = {
    insertOne: async (document: SessionDocument) => { tokens.set(document.tokenHash, document); },
    findOneAndDelete: async (filter: { tokenHash: string }) => {
      const session = tokens.get(filter.tokenHash) ?? null;
      tokens.delete(filter.tokenHash);
      return session;
    },
  } as unknown as Collection<SessionDocument>;
  const refreshToken = await createRefreshSession(collection, "user-123", secret);
  const firstRotation = await rotateRefreshSession(collection, refreshToken, secret);
  assert.equal(firstRotation?.userId, "user-123");
  assert.equal(await rotateRefreshSession(collection, refreshToken, secret), null);
});
