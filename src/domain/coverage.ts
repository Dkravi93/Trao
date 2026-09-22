import type { Question, Requirement } from "./kit-schema.js";

export function findUncoveredMustHaveRequirements(
  requirements: readonly Requirement[],
  questions: readonly Question[],
): string[] {
  const coveredIds = new Set(questions.flatMap((question) => question.requirement_ids));
  return requirements
    .filter((requirement) => requirement.priority === "must" && !coveredIds.has(requirement.id))
    .map((requirement) => requirement.id);
}
