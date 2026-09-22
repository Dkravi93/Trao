import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, keyLength) as Buffer;
  return `${salt}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedValue: string): Promise<boolean> {
  const [salt, expected] = storedValue.split(":");
  if (!salt || !expected) return false;
  const candidate = await scrypt(password, salt, keyLength) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === candidate.length && timingSafeEqual(expectedBuffer, candidate);
}
