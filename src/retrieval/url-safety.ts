import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const privateIpv4Ranges = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return privateIpv4Ranges.some((range) => range.test(address));
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export async function validateFetchUrl(value: string, allowPrivate = process.env.ALLOW_PRIVATE_URLS === "true"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError("A valid absolute company URL is required.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new UnsafeUrlError("Only credential-free HTTP(S) URLs are allowed.");
  }
  if (allowPrivate) return url;
  if (url.hostname === "localhost" || isPrivateAddress(url.hostname)) {
    throw new UnsafeUrlError("Private, loopback, and link-local addresses are not allowed.");
  }
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new UnsafeUrlError("The company URL resolves to a private address.");
    }
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError("The company hostname could not be resolved.");
  }
  return url;
}
