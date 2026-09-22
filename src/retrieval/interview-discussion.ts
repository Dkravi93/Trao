import { fetchText } from "./http-client.js";

/** Searches public, non-company material separately from the company crawl. Failures are non-fatal. */
export async function findInterviewDiscussion(companyName: string): Promise<string[]> {
  const query = encodeURIComponent(`${companyName} interview process experiences`);
  const searchUrl = new URL(`https://html.duckduckgo.com/html/?q=${query}`);
  try {
    const result = await fetchText(searchUrl, { timeoutMs: 5_000 });
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
    return [...new Set(urls)].slice(0, 3);
  } catch {
    return [];
  }
}
