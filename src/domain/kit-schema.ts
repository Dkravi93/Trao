import { z } from "zod";

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(["technical", "behavioural", "domain"]),
  priority: z.enum(["must", "nice"]),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string().min(1)),
  minutes: z.number().int().min(0),
});

export const kitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().min(0),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(requirementSchema),
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({
    days_available: z.number().int().min(1).max(60),
    days: z.array(scheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().min(1),
  }),
  research: z.object({
    warnings: z.array(z.string()),
    interview_discussion_urls: z.array(z.string()),
  }).optional(),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Kit = z.infer<typeof kitSchema>;

export function validateKit(kit: unknown): Kit {
  const parsed = kitSchema.parse(kit);
  const requirementIds = new Set(parsed.role.requirements.map((requirement) => requirement.id));
  const questionIds = new Set(parsed.questions.map((question) => question.id));

  if (requirementIds.size !== parsed.role.requirements.length || questionIds.size !== parsed.questions.length) {
    throw new Error("Requirement and question ids must be unique within a kit.");
  }
  if (parsed.schedule.days.length !== parsed.schedule.days_available) {
    throw new Error("Schedule day count must equal days_available.");
  }
  for (const question of parsed.questions) {
    if (question.requirement_ids.some((id) => !requirementIds.has(id))) {
      throw new Error(`Question ${question.id} references an unknown requirement.`);
    }
  }
  for (const day of parsed.schedule.days) {
    if (day.question_ids.some((id) => !questionIds.has(id))) {
      throw new Error(`Schedule day ${day.day} references an unknown question.`);
    }
  }
  const coveredRequirementIds = new Set(parsed.questions.flatMap((question) => question.requirement_ids));
  const actualGaps = parsed.role.requirements
    .filter((requirement) => requirement.priority === "must" && !coveredRequirementIds.has(requirement.id))
    .map((requirement) => requirement.id)
    .sort();
  if (actualGaps.join("|") !== [...parsed.coverage.uncovered_requirement_ids].sort().join("|")) {
    throw new Error("Coverage must report exactly the uncovered must-have requirements.");
  }
  const scheduledQuestionIds = new Set(parsed.schedule.days.flatMap((day) => day.question_ids));
  for (const requirement of parsed.role.requirements.filter((item) => item.priority === "must")) {
    const hasScheduledQuestion = parsed.questions.some(
      (question) => question.requirement_ids.includes(requirement.id) && scheduledQuestionIds.has(question.id),
    );
    if (!hasScheduledQuestion) {
      throw new Error(`Must-have requirement ${requirement.id} is absent from the schedule.`);
    }
  }
  return parsed;
}
