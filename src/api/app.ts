import { createHash } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { ZodError, z } from "zod";
import { generateKitForCase } from "../application/generate-kit.js";
import { validateKit } from "../domain/kit-schema.js";
import type { ApiConfig } from "./config.js";
import type { Database, KitDocument } from "./database.js";
import { publicUser } from "./database.js";
import { hashPassword, verifyPassword } from "./auth/passwords.js";
import { accessCookie, createRefreshSession, isAccessTokenRevoked, issueAccessToken, refreshCookie, revokeAccessToken, revokeRefreshSession, rotateRefreshSession, verifyAccessToken, type AccessTokenClaims } from "./auth/sessions.js";

interface AuthenticatedRequest extends Request { userId?: string; accessClaims?: AccessTokenClaims; }
const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(12).max(128) });
const createKitSchema = z.object({ jd: z.string().min(1).max(50_000), company_url: z.string().url().max(2_048), days: z.number().int().min(1).max(60) });
const batchKitSchema = z.array(createKitSchema).min(1).max(5);

function cookieValue(request: Request, name: string): string | undefined {
  const item = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
}
function accessTokenFrom(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : cookieValue(request, accessCookie.name);
}
function fingerprint(input: z.infer<typeof createKitSchema>): string {
  return createHash("sha256").update(`${input.jd}\u0000${input.company_url}\u0000${input.days}`).digest("hex");
}
function publicKit(document: { _id: ObjectId } & KitDocument) {
  return { id: document._id.toHexString(), status: document.status, kit: document.kit, error: document.error, created_at: document.createdAt.toISOString(), updated_at: document.updatedAt.toISOString() };
}
function objectIdParam(request: Request): ObjectId | null {
  const value = request.params.id;
  return typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export function createApiApp(database: Database, config: ApiConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors({ credentials: true, origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed."));
  } }));
  app.use(express.json({ limit: "128kb" }));

  const requireAuth = async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    try {
      const claims = verifyAccessToken(accessTokenFrom(request) ?? "", config.sessionSecret);
      if (!claims || await isAccessTokenRevoked(database.revokedAccessTokens, claims.jti)) return response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } });
      request.userId = claims.sub;
      request.accessClaims = claims;
      return next();
    } catch (error) { return next(error); }
  };
  const cookieOptions = (maxAge: number, path: string) => ({ httpOnly: true, secure: config.isProduction, sameSite: "lax" as const, maxAge, path });
  const issueTokenPair = async (response: Response, userId: string) => {
    response.cookie(accessCookie.name, issueAccessToken(userId, config.sessionSecret), cookieOptions(accessCookie.maxAge, accessCookie.path));
    response.cookie(refreshCookie.name, await createRefreshSession(database.sessions, userId, config.sessionSecret), cookieOptions(refreshCookie.maxAge, refreshCookie.path));
  };
  const issueAccessAndRefresh = (response: Response, userId: string, refreshToken: string) => {
    response.cookie(accessCookie.name, issueAccessToken(userId, config.sessionSecret), cookieOptions(accessCookie.maxAge, accessCookie.path));
    response.cookie(refreshCookie.name, refreshToken, cookieOptions(refreshCookie.maxAge, refreshCookie.path));
  };

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.post("/auth/register", async (request, response, next) => {
    try {
      const input = credentialsSchema.parse(request.body);
      const created = await database.users.insertOne({ email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), createdAt: new Date() });
      await issueTokenPair(response, created.insertedId.toHexString());
      response.status(201).json({ user: { id: created.insertedId.toHexString(), email: input.email.toLowerCase() } });
    } catch (error) { next(error); }
  });
  app.post("/auth/login", async (request, response, next) => {
    try {
      const input = credentialsSchema.parse(request.body);
      const user = await database.users.findOne({ email: input.email.toLowerCase() });
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) return response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
      await issueTokenPair(response, user._id.toHexString());
      return response.json({ user: publicUser(user) });
    } catch (error) { return next(error); }
  });
  app.post("/auth/logout", async (request, response, next) => {
    try {
      const claims = verifyAccessToken(accessTokenFrom(request) ?? "", config.sessionSecret);
      if (claims) await revokeAccessToken(database.revokedAccessTokens, claims);
      await revokeRefreshSession(database.sessions, cookieValue(request, refreshCookie.name), config.sessionSecret);
      response.clearCookie(accessCookie.name, cookieOptions(0, accessCookie.path));
      response.clearCookie(refreshCookie.name, cookieOptions(0, refreshCookie.path));
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/auth/refresh", async (request, response, next) => {
    try {
      const rotated = await rotateRefreshSession(database.sessions, cookieValue(request, refreshCookie.name), config.sessionSecret);
      if (!rotated) return response.status(401).json({ error: { code: "INVALID_REFRESH_TOKEN", message: "Please sign in again." } });
      issueAccessAndRefresh(response, rotated.userId, rotated.token);
      return response.status(204).end();
    } catch (error) { return next(error); }
  });
  app.get("/auth/me", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const user = await database.users.findOne({ _id: new ObjectId(request.userId) });
      if (!user) return response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Session is no longer valid." } });
      return response.json({ user: publicUser(user) });
    } catch (error) { return next(error); }
  });

  app.get("/kits", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const documents = await database.kits.find({ userId: request.userId }).sort({ updatedAt: -1 }).toArray();
      response.json({ kits: documents.map(publicKit) });
    } catch (error) { next(error); }
  });
  app.post("/kits", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const input = createKitSchema.parse(request.body);
      const existing = await database.kits.findOne({ userId: request.userId, fingerprint: fingerprint(input) });
      if (existing) return response.status(200).json({ kit: publicKit(existing), deduplicated: true });
      const now = new Date();
      const created = await database.kits.insertOne({ userId: request.userId!, fingerprint: fingerprint(input), status: "generating", input, kit: null, error: null, createdAt: now, updatedAt: now });
      const kitId = created.insertedId;
      void generateKitForCase({ id: kitId.toHexString(), ...input }).then(
        (kit) => database.kits.updateOne({ _id: kitId }, { $set: { status: "ready", kit, error: null, updatedAt: new Date() } }),
        (error: unknown) => database.kits.updateOne({ _id: kitId }, { $set: { status: "failed", error: { code: "GENERATION_FAILED", message: error instanceof Error ? error.message : "Unknown error" }, updatedAt: new Date() } }),
      );
      const document = await database.kits.findOne({ _id: kitId });
      return response.status(202).json({ kit: document ? publicKit(document) : { id: kitId.toHexString(), status: "generating" } });
    } catch (error) { return next(error); }
  });
  app.post("/kits/batch", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const inputs = batchKitSchema.parse(request.body);
      const results = [];
      for (const input of inputs) {
        const existing = await database.kits.findOne({ userId: request.userId, fingerprint: fingerprint(input) });
        if (existing) {
          results.push(publicKit(existing));
          continue;
        }
        const now = new Date();
        const created = await database.kits.insertOne({ userId: request.userId!, fingerprint: fingerprint(input), status: "generating", input, kit: null, error: null, createdAt: now, updatedAt: now });
        const kitId = created.insertedId;
        void generateKitForCase({ id: kitId.toHexString(), ...input }).then(
          (kit) => database.kits.updateOne({ _id: kitId }, { $set: { status: "ready", kit, error: null, updatedAt: new Date() } }),
          (error: unknown) => database.kits.updateOne({ _id: kitId }, { $set: { status: "failed", error: { code: "GENERATION_FAILED", message: error instanceof Error ? error.message : "Unknown error" }, updatedAt: new Date() } }),
        );
        results.push({ id: kitId.toHexString(), status: "generating", kit: null, error: null, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      return response.status(202).json({ kits: results });
    } catch (error) { return next(error); }
  });
  app.get("/kits/:id", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request);
      if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const kit = await database.kits.findOne({ _id: kitId, userId: request.userId });
      if (!kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      return response.json({ kit: publicKit(kit) });
    } catch (error) { return next(error); }
  });
  app.put("/kits/:id", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request);
      if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const kit = validateKit(request.body);
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, status: "ready", error: null, updatedAt: new Date() } }, { returnDocument: "after" });
      if (!result) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      return response.json({ kit: publicKit(result) });
    } catch (error) { return next(error); }
  });
  app.get("/kits/:id/progress", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request);
      if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const kit = await database.kits.findOne({ _id: kitId, userId: request.userId });
      if (!kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const progress = await database.practiceProgress.findOne({ userId: request.userId, kitId: kitId.toHexString() });
      return response.json({ confidence: progress?.confidence ?? {} });
    } catch (error) { return next(error); }
  });
  app.put("/kits/:id/progress", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request);
      if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const kit = await database.kits.findOne({ _id: kitId, userId: request.userId });
      if (!kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = z.object({ card_id: z.string().min(1), confidence: z.number().int().min(1).max(5) }).parse(request.body);
      const cardIds = new Set(kit.kit?.flashcards.map((card) => card.id) ?? []);
      if (!cardIds.has(input.card_id)) return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Unknown flashcard." } });
      const current = await database.practiceProgress.findOne({ userId: request.userId, kitId: kitId.toHexString() });
      const confidence = { ...(current?.confidence ?? {}), [input.card_id]: input.confidence };
      await database.practiceProgress.updateOne(
        { userId: request.userId, kitId: kitId.toHexString() },
        { $set: { userId: request.userId, kitId: kitId.toHexString(), confidence, updatedAt: new Date() } },
        { upsert: true },
      );
      return response.json({ confidence });
    } catch (error) { return next(error); }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request data is invalid.", details: error.issues } });
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return response.status(409).json({ error: { code: "CONFLICT", message: "A record with that value already exists." } });
    console.error(error);
    return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
  });
  return app;
}
