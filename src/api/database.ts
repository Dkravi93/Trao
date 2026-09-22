import { MongoClient, type Collection, type Db, type WithId } from "mongodb";
import type { Kit } from "../domain/kit-schema.js";

export interface UserDocument {
  email: string;
  passwordHash: string;
  createdAt: Date;
}
export interface SessionDocument {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}
export interface KitDocument {
  userId: string;
  fingerprint: string;
  status: "generating" | "ready" | "failed";
  input: { jd: string; company_url: string; days: number };
  kit: Kit | null;
  error: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Database {
  users: Collection<UserDocument>;
  sessions: Collection<SessionDocument>;
  kits: Collection<KitDocument>;
  close(): Promise<void>;
}

export async function connectDatabase(mongoUri: string): Promise<Database> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const database: Db = client.db();
  const users = database.collection<UserDocument>("users");
  const sessions = database.collection<SessionDocument>("sessions");
  const kits = database.collection<KitDocument>("kits");
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    kits.createIndex({ userId: 1, fingerprint: 1 }, { unique: true }),
  ]);
  return { users, sessions, kits, close: () => client.close() };
}

export function publicUser(user: WithId<UserDocument>): { id: string; email: string } {
  return { id: user._id.toHexString(), email: user.email };
}
