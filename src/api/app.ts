import { createHash } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { ZodError, z } from "zod";
import { generateKitForCase } from "../application/generate-kit.js";
import { flashcardSchema, questionSchema, validateKit, type Flashcard, type Kit, type Question } from "../domain/kit-schema.js";
import { allocateSchedule } from "../domain/schedule.js";
import { findUncoveredMustHaveRequirements } from "../domain/coverage.js";
import { generateCompanyBrief, generateQuestions } from "../generation/llm-generation.js";
import { pageText, researchCompany } from "../retrieval/company-research.js";
import { RetrievalError } from "../retrieval/http-client.js";
import { UnsafeUrlError } from "../retrieval/url-safety.js";
import type { ApiConfig } from "./config.js";
import type { Database, KitDocument } from "./database.js";
import { publicUser } from "./database.js";
import { hashPassword, verifyPassword } from "./auth/passwords.js";
import { accessCookie, createRefreshSession, isAccessTokenRevoked, issueAccessToken, refreshCookie, revokeAccessToken, revokeRefreshSession, rotateRefreshSession, verifyAccessToken, type AccessTokenClaims } from "./auth/sessions.js";

interface AuthenticatedRequest extends Request { userId?: string; accessClaims?: AccessTokenClaims; }
const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(12).max(128) });
const createKitSchema = z.object({ jd: z.string().min(1).max(50_000), company_url: z.string().url().max(2_048), days: z.number().int().min(1).max(60) });
const batchKitSchema = z.array(createKitSchema).min(1).max(5);
const questionPatchSchema = z.object({ prompt: z.string().min(1).optional(), answer_outline: z.string().optional(), category: questionSchema.shape.category.optional(), difficulty: questionSchema.shape.difficulty.optional(), requirement_ids: questionSchema.shape.requirement_ids.optional() }).refine((value) => Object.keys(value).length > 0);
const flashcardPatchSchema = z.object({ front: z.string().min(1).optional(), back: z.string().min(1).optional(), requirement_ids: flashcardSchema.shape.requirement_ids.optional() }).refine((value) => Object.keys(value).length > 0);
const briefPatchSchema = z.object({ summary: z.string().optional(), what_they_do: z.string().optional() }).refine((value) => Object.keys(value).length > 0);
const questionCreateSchema = questionSchema.omit({ id: true }).extend({ id: z.string().min(1).optional() });
const flashcardCreateSchema = flashcardSchema.omit({ id: true }).extend({ id: z.string().min(1).optional() });

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
function nextId(prefix: string, ids: readonly string[]): string {
  const used = new Set(ids);
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}
function deriveKit(kit: Kit): Kit {
  const schedule = allocateSchedule(kit.role.requirements, kit.questions, kit.schedule.days_available);
  return { ...kit, schedule: { ...kit.schedule, days: schedule }, coverage: { ...kit.coverage, uncovered_requirement_ids: findUncoveredMustHaveRequirements(kit.role.requirements, kit.questions) } };
}
// Same classification the CLI batch command already uses, so the UI can show
// a real reason ("company unreachable", "invalid company URL") instead of a
// blanket "generation failed" for every failure mode.
function generationErrorCode(error: unknown): string {
  if (error instanceof RetrievalError) return error.code;
  if (error instanceof UnsafeUrlError) return "INVALID_COMPANY_URL";
  return "GENERATION_FAILED";
}
// Generation runs fire-and-forget after the request already returned 202, so
// this is the only place a failure is ever visible unless we log it here —
// without this, failures are silent on stdout and only discoverable by
// re-querying the kit document afterward.
function logGenerationFailure(kitId: ObjectId, error: unknown): void {
  console.error(`[kit ${kitId.toHexString()}] generation failed:`, error instanceof Error ? error.stack ?? error.message : error);
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
        (error: unknown) => { logGenerationFailure(kitId, error); return database.kits.updateOne({ _id: kitId }, { $set: { status: "failed", error: { code: generationErrorCode(error), message: error instanceof Error ? error.message : "Unknown error" }, updatedAt: new Date() } }); },
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
          (error: unknown) => { logGenerationFailure(kitId, error); return database.kits.updateOne({ _id: kitId }, { $set: { status: "failed", error: { code: generationErrorCode(error), message: error instanceof Error ? error.message : "Unknown error" }, updatedAt: new Date() } }); },
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
  app.delete("/kits/:id", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request);
      if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      // Scoped to userId so this can only ever delete the caller's own kit —
      // matches every other /kits/:id route's ownership check.
      const result = await database.kits.deleteOne({ _id: kitId, userId: request.userId });
      if (result.deletedCount === 0) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      await database.practiceProgress.deleteOne({ userId: request.userId, kitId: kitId.toHexString() });
      return response.status(204).end();
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
  app.patch("/kits/:id/brief", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = briefPatchSchema.parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const brief = { ...document.kit.company_brief, ...input, pinned: true };
      const kit = validateKit({ ...document.kit, company_brief: brief });
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.patch("/kits/:id/questions/:qid", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = questionPatchSchema.parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      const current = document?.kit?.questions.find((question) => question.id === request.params.qid);
      if (!document?.kit || !current) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found." } });
      const questions = document.kit.questions.map((question) => question.id === current.id ? { ...question, ...input, pinned: true } : question);
      const kit = validateKit(deriveKit({ ...document.kit, questions }));
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.post("/kits/:id/questions", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = questionCreateSchema.parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const question: Question = { ...input, id: input.id ?? nextId("q", document.kit.questions.map((item) => item.id)), pinned: true };
      if (document.kit.questions.some((item) => item.id === question.id)) return response.status(409).json({ error: { code: "CONFLICT", message: "Question id already exists." } });
      const kit = validateKit(deriveKit({ ...document.kit, questions: [...document.kit.questions, question] }));
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.status(201).json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.delete("/kits/:id/questions/:qid", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit || !document.kit.questions.some((question) => question.id === request.params.qid)) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found." } });
      const questions = document.kit.questions.filter((question) => question.id !== request.params.qid);
      const kit = validateKit(deriveKit({ ...document.kit, questions }));
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.put("/kits/:id/questions", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = z.object({ questions: z.array(questionSchema) }).parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const pinnedById = new Map(document.kit.questions.filter((question) => question.pinned).map((question) => [question.id, question]));
      const questions = input.questions.map((question) => pinnedById.get(question.id) ?? question);
      const kit = validateKit(deriveKit({ ...document.kit, questions }));
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.patch("/kits/:id/flashcards/:fid", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = flashcardPatchSchema.parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      const current = document?.kit?.flashcards.find((card) => card.id === request.params.fid);
      if (!document?.kit || !current) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Flashcard not found." } });
      const flashcards = document.kit.flashcards.map((card) => card.id === current.id ? { ...card, ...input, pinned: true } : card);
      const kit = validateKit({ ...document.kit, flashcards });
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.post("/kits/:id/flashcards", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = flashcardCreateSchema.parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const flashcard: Flashcard = { ...input, id: input.id ?? nextId("f", document.kit.flashcards.map((item) => item.id)), pinned: true };
      if (document.kit.flashcards.some((item) => item.id === flashcard.id)) return response.status(409).json({ error: { code: "CONFLICT", message: "Flashcard id already exists." } });
      const kit = validateKit({ ...document.kit, flashcards: [...document.kit.flashcards, flashcard] });
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.status(201).json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.delete("/kits/:id/flashcards/:fid", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit || !document.kit.flashcards.some((card) => card.id === request.params.fid)) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Flashcard not found." } });
      const kit = validateKit({ ...document.kit, flashcards: document.kit.flashcards.filter((card) => card.id !== request.params.fid) });
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
    } catch (error) { return next(error); }
  });
  app.post("/kits/:id/regenerate", requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = objectIdParam(request); if (!kitId) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      const input = z.object({ target: z.enum(["brief", "category", "schedule"]), category: questionSchema.shape.category.optional(), force: z.boolean().optional() }).parse(request.body);
      const document = await database.kits.findOne({ _id: kitId, userId: request.userId, status: "ready" });
      if (!document?.kit) return response.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      let kit = document.kit;
      if (input.target === "brief") {
        if (kit.company_brief.pinned && !input.force) return response.status(409).json({ error: { code: "PINNED", message: "The company brief has manual edits. Confirm regeneration to replace them." } });
        const research = await researchCompany(kit.source.company_url);
        const brief = await generateCompanyBrief(research.pages.map(pageText));
        kit = { ...kit, company_brief: { ...brief, sources: research.pages.map((page) => page.url) } };
      } else if (input.target === "schedule") {
        kit = deriveKit(kit);
      } else {
        if (!input.category) return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Category is required." } });
        const requirements = kit.role.requirements.filter((requirement) => input.category === "behavioural" ? requirement.kind === "behavioural" : input.category === "technical" ? requirement.kind === "technical" : requirement.kind === "domain");
        const generated = await generateQuestions(requirements);
        const preserved = kit.questions.filter((question) => question.category !== input.category || question.pinned);
        const ids = preserved.map((question) => question.id);
        const replacement = generated.map((question) => { const id = nextId("q", ids); ids.push(id); return { ...question, id, category: input.category! }; });
        kit = deriveKit({ ...kit, questions: [...preserved, ...replacement] });
      }
      const saved = validateKit(kit);
      const result = await database.kits.findOneAndUpdate({ _id: kitId, userId: request.userId }, { $set: { kit: saved, updatedAt: new Date() } }, { returnDocument: "after" });
      return response.json({ kit: publicKit(result!) });
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