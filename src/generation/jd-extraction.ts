import type { Requirement } from "../domain/kit-schema.js";

export interface ExtractedRole {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
}

const requirementSignals = /\b(required|must|minimum|qualification|experience|proficien|knowledge|skill|ability|degree|certification|years?|responsible for|you will)\b/i;
const niceSignals = /\b(preferred|bonus|nice to have|plus|ideally|desirable)\b/i;
const behaviouralSignals = /\b(mentor|communicat|collaborat|stakeholder|leadership|teamwork|coach|influence)\b/i;
const technicalSignals = /\b(api|react|node|typescript|javascript|python|java|sql|database|cloud|aws|azure|gcp|docker|kubernetes|testing|system|frontend|backend|software|engineering|graphql)\b/i;

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim();
}

function splitCandidates(jd: string): string[] {
  return jd.replace(/\r/g, "").split("\n")
    .flatMap((line) => line.includes(";") ? line.split(";") : [line])
    .map(cleanLine)
    .filter((line) => line.length >= 12 && line.length <= 400);
}

export function extractRoleFromJobDescription(jd: string): ExtractedRole {
  const lines = splitCandidates(jd);
  const title = lines[0] ?? "Interview role";
  const seniority = /\b(senior|staff|principal|lead|junior|intern|manager)\b/i.exec(title)?.[0] ?? "";
  const selected = lines.filter((line, index) => index > 0 && requirementSignals.test(line) && !/^\s*(requirements?|qualifications?|responsibilities)\s*:??\s*$/i.test(line));
  const unique = [...new Set(selected.map((line) => line.replace(/^(required|preferred|qualifications?)\s*:?\s*/i, "").trim()))].slice(0, 15);
  const requirements: Requirement[] = unique.map((text, index) => ({
    id: `r${index + 1}`,
    text,
    kind: behaviouralSignals.test(text) ? "behavioural" : technicalSignals.test(text) ? "technical" : "domain",
    priority: niceSignals.test(text) ? "nice" : "must",
  }));
  const responsibilities = lines
    .filter((line) => /\b(responsible for|you will|build|design|deliver|own|lead)\b/i.test(line))
    .slice(0, 8);
  return { title, seniority, responsibilities, requirements };
}
