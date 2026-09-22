export interface RetrievedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export class RetrievalError extends Error {
  constructor(public readonly code: "COMPANY_UNREACHABLE" | "UNSUPPORTED_CONTENT" | "RESPONSE_TOO_LARGE", message: string) {
    super(message);
    this.name = "RetrievalError";
  }
}

const maxBytes = 1_000_000;
const attempts = 3;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchText(url: URL, options: { timeoutMs?: number } = {}): Promise<RetrievedPage> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let requestUrl = url;
      let response: Response | undefined;
      for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
        response = await fetch(requestUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers: { "user-agent": "TraoInterviewPrepBot/0.1 (respectful research crawler)" },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location) throw new RetrievalError("COMPANY_UNREACHABLE", "Remote server sent a redirect without a location.");
        requestUrl = await validateFetchUrl(new URL(location, requestUrl).href);
      }
      if (!response) throw new RetrievalError("COMPANY_UNREACHABLE", "No response received from remote server.");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        throw new RetrievalError("COMPANY_UNREACHABLE", "Remote server exceeded the redirect limit.");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > maxBytes) throw new RetrievalError("RESPONSE_TOO_LARGE", "The remote page exceeds the 1 MB limit.");
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        throw new RetrievalError("UNSUPPORTED_CONTENT", "The remote page is not HTML or plain text.");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > maxBytes) throw new RetrievalError("RESPONSE_TOO_LARGE", "The remote page exceeds the 1 MB limit.");
      if (!response.ok) throw new RetrievalError("COMPANY_UNREACHABLE", `Remote server returned HTTP ${response.status}.`);
      return { url: requestUrl.href, status: response.status, contentType, body };
    } catch (error) {
      lastError = error;
      if (error instanceof RetrievalError && error.code !== "COMPANY_UNREACHABLE") throw error;
      if (attempt < attempts - 1) await delay(300 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof RetrievalError) throw lastError;
  throw new RetrievalError("COMPANY_UNREACHABLE", "Company site unreachable after 3 retries.");
}
import { validateFetchUrl } from "./url-safety.js";
