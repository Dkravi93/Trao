import { fetchText } from "./http-client.js";

/** Searches public, non-company material separately from the company crawl. Failures are non-fatal. */
const searchUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function findInterviewDiscussion(companyName: string): Promise<string[]> {
  const query = encodeURIComponent(`${companyName} interview process experiences`);
  const searchUrl = new URL(`https://html.duckduckgo.com/html/?q=${query}`);
  try {
    const result = await fetchText(searchUrl, { timeoutMs: 5_000, userAgent: searchUserAgent });
    const urls: string[] = [];
    for (const match of result.body.matchAll(/(?:result__a|result-link)[^>]*href=["']([^"']+)["']/gi)) {
      const raw = match[1];
      if (!raw) continue;
      try {
        const url = new URL(raw, searchUrl);
        const target = url.searchParams.get("uddg") ?? url.href;
        if (/^https?:\/\//i.test(target) && !target.includes(companyName)) urls.push(target);
      } catch {
        // Ignore malformed search results.
      }
    }
    const found = [...new Set(urls)].slice(0, 3);
    if (found.length === 0) {
      // Diagnostic only — tells you whether this was a genuine empty result
      // or DuckDuckGo silently blocking/serving something unparseable, which
      // otherwise look identical from the caller's side.
      console.warn(
        `[interview-discussion] zero results for "${companyName}" — status ${result.status}, body length ${result.body.length}, snippet: ${result.body.slice(0, 200).replace(/\s+/g, " ")}`,
      );
    }
    return found;
  } catch (error) {
    console.warn(`[interview-discussion] search request failed for "${companyName}":`, error instanceof Error ? error.message : error);
    return [];
  }
}
