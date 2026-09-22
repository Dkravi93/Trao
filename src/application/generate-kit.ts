import { allocateSchedule } from "../domain/schedule.js";
import { findUncoveredMustHaveRequirements } from "../domain/coverage.js";
import { validateKit, type Kit, type Requirement } from "../domain/kit-schema.js";
import type { EvaluationCase } from "../cli/contracts.js";
import { extractRole, generateQuestions } from "../generation/llm-generation.js";
import { generateQuestionsForRequirements } from "../generation/questions.js";
import { pageText, researchCompany } from "../retrieval/company-research.js";

function firstNonEmptyLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Interview role";
}

/**
 * Phase 1 composition root. Retrieval and LLM-backed extraction plug into this
 * function in Phase 2, so the web application and batch command share one path.
 */
export async function generateKitForCase(input: EvaluationCase): Promise<Kit> {
  const role = await extractRole(input.jd);
  const research = await researchCompany(input.company_url);
  const requirements: Requirement[] = role.requirements;
  let questions = await generateQuestions(requirements);
  let uncovered = findUncoveredMustHaveRequirements(requirements, questions);
  // The second pass is intentionally based on deterministic coverage, not an LLM judgment.
  if (uncovered.length > 0) {
    const missing = requirements.filter((requirement) => uncovered.includes(requirement.id));
    questions = [...questions, ...generateQuestionsForRequirements(missing, questions.length + 1)];
    uncovered = findUncoveredMustHaveRequirements(requirements, questions);
  }
  const schedule = allocateSchedule(requirements, questions, input.days);
  const evidence = research.pages.map(pageText).filter(Boolean);
  const homepageText = evidence[0] ?? "";

  return validateKit({
    source: {
      company: new URL(input.company_url).hostname,
      company_url: input.company_url,
      role: role.title || firstNonEmptyLine(input.jd),
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: research.pages.map((page) => page.url),
    },
    company_brief: {
      summary: homepageText ? homepageText.slice(0, 600) : "No company information could be retrieved.",
      what_they_do: homepageText ? homepageText.slice(0, 300) : "No company facts were inferred because research was unavailable.",
      sources: research.pages.map((page) => page.url),
    },
    role: { title: role.title, seniority: role.seniority, responsibilities: role.responsibilities, requirements },
    questions,
    flashcards: requirements.map((requirement, index) => ({
      id: `f${index + 1}`,
      front: requirement.text,
      back: "Prepare a concise example that demonstrates this requirement.",
      requirement_ids: [requirement.id],
    })),
    schedule: { days_available: input.days, days: schedule },
    coverage: { uncovered_requirement_ids: uncovered, passes: 2 },
    research: { warnings: research.warnings, interview_discussion_urls: research.interviewDiscussionUrls },
  });
}
