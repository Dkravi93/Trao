import type { Question, Requirement } from "../domain/kit-schema.js";

function categoryFor(requirement: Requirement): Question["category"] {
  if (requirement.kind === "behavioural") return "behavioural";
  if (/architecture|scalab|distributed|system design/i.test(requirement.text)) return "system-design";
  return "technical";
}

function promptFor(requirement: Requirement, category: Question["category"]): string {
  if (category === "behavioural") return `Tell me about a specific time you demonstrated: ${requirement.text}`;
  if (category === "system-design") return `How would you approach a system-design problem involving: ${requirement.text}?`;
  return `Explain your hands-on experience with: ${requirement.text}`;
}

/** Each requirement is handled independently, enabling later LLM calls per category without coupling prompts. */
export function generateQuestionsForRequirements(requirements: readonly Requirement[], startingIndex = 1): Question[] {
  return requirements.map((requirement, index) => {
    const category = categoryFor(requirement);
    return {
      id: `q${startingIndex + index}`,
      requirement_ids: [requirement.id],
      category,
      prompt: promptFor(requirement, category),
      answer_outline: "Use a concrete example, explain your decisions, and connect the result to the role requirement.",
      difficulty: requirement.priority === "must" ? 2 : 1,
    };
  });
}
