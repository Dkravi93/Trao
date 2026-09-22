import { allocateSchedule } from "../domain/schedule.js";
import { findUncoveredMustHaveRequirements } from "../domain/coverage.js";
import { validateKit, type Kit, type Requirement } from "../domain/kit-schema.js";
import type { EvaluationCase } from "../cli/contracts.js";

function firstNonEmptyLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Interview role";
}

/**
 * Phase 1 composition root. Retrieval and LLM-backed extraction plug into this
 * function in Phase 2, so the web application and batch command share one path.
 */
export async function generateKitForCase(input: EvaluationCase): Promise<Kit> {
  const title = firstNonEmptyLine(input.jd);
  const requirements: Requirement[] = input.jd.trim()
    ? [{ id: "r1", text: "Review the provided job description and clarify the role expectations.", kind: "domain", priority: "nice" }]
    : [];
  const questions = requirements.map((requirement) => ({
    id: "q1",
    requirement_ids: [requirement.id],
    category: "company-fit" as const,
    prompt: "What would success in this role look like during your first 90 days?",
    answer_outline: "Connect your answer to evidence from the job description and the company research.",
    difficulty: 1,
  }));
  const uncovered = findUncoveredMustHaveRequirements(requirements, questions);
  const schedule = allocateSchedule(requirements, questions, input.days);

  return validateKit({
    source: {
      company: new URL(input.company_url).hostname,
      company_url: input.company_url,
      role: title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: {
      summary: "Company research will be added during the retrieval phase.",
      what_they_do: "No company facts have been inferred at this stage.",
      sources: [],
    },
    role: { title, seniority: "", responsibilities: [], requirements },
    questions,
    flashcards: [],
    schedule: { days_available: input.days, days: schedule },
    coverage: { uncovered_requirement_ids: uncovered, passes: 1 },
  });
}
