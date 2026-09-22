import { fetchText, type RetrievedPage } from "./http-client.js";
import { validateFetchUrl } from "./url-safety.js";
import { findInterviewDiscussion } from "./interview-discussion.js";

export interface ResearchResult {
  pages: RetrievedPage[];
  warnings: string[];
  interviewDiscussionUrls: string[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html: string, base: URL): Array<{ url: URL; label: string }> {
  const links: Array<{ url: URL; label: string }> = [];
  const anchor = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    try {
      const url = new URL(match[1] ?? "", base);
      if (url.origin !== base.origin || !["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      links.push({ url, label: htmlToText(match[2] ?? "") });
    } catch {
      // Malformed links are untrusted input and are ignored.
    }
  }
  return links;
}

function rankLink(link: { url: URL; label: string }): number {
  const value = `${link.url.pathname} ${link.label}`.toLowerCase();
  const terms = ["career", "hiring", "interview", "jobs", "culture", "about", "company", "team", "handbook", "engineering"];
  return terms.reduce((score, term) => score + (value.includes(term) ? 10 : 0), 0);
}

// NEW: turns a hostname like "about.gitlab.com" into a plain company name like "gitlab"
// so the interview-discussion search query is meaningful instead of literally
// searching for the hostname string.
function guessCompanyName(hostname: string): string {
  const parts = hostname.replace(/^www\./, "").split(".");
  return parts.length > 2 ? (parts[1] ?? parts[0] ?? "") : (parts[0] ?? "");
}

async function isAllowedByRobots(origin: URL): Promise<boolean> {
  try {
    const robots = await fetchText(new URL("/robots.txt", origin), { timeoutMs: 3_000 });
    const lines = robots.body.split(/\r?\n/);
    let applies = false;
    const disallowed: string[] = [];
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || value.toLowerCase().includes("trao");
      if (applies && key === "disallow" && value) disallowed.push(value);
    }
    return !disallowed.includes("/");
  } catch {
    return true; // Unavailable robots.txt is recorded as a warning by the caller, not a hard failure.
  }
}

export async function researchCompany(companyUrl: string): Promise<ResearchResult> {
  const startUrl = await validateFetchUrl(companyUrl);
  const warnings: string[] = [];
  if (!(await isAllowedByRobots(startUrl))) {
    return { pages: [], warnings: ["Crawling is disallowed by robots.txt."], interviewDiscussionUrls: [] };
  }
  const homepage = await fetchText(startUrl);
  const candidates = extractLinks(homepage.body, new URL(homepage.url))
    .sort((left, right) => rankLink(right) - rankLink(left))
    .filter((link, index, all) => all.findIndex((item) => item.url.href === link.url.href) === index)
    .slice(0, 4);
  const extraPages = await Promise.all(candidates.map(async (link) => {
    try {
      return await fetchText(link.url);
    } catch (error) {
      warnings.push(`Skipped ${link.url.href}: ${error instanceof Error ? error.message : "retrieval failed"}`);
      return null;
    }
  }));

  // CHANGED: was findInterviewDiscussion(startUrl.hostname)
  const interviewDiscussionUrls = await findInterviewDiscussion(guessCompanyName(startUrl.hostname));
  if (interviewDiscussionUrls.length === 0) warnings.push("No public interview-process discussion was found.");
  return { pages: [homepage, ...extraPages.filter((page): page is RetrievedPage => page !== null)], warnings, interviewDiscussionUrls };
}

export function pageText(page: RetrievedPage): string {
  return htmlToText(page.body);
}