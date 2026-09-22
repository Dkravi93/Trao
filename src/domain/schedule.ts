import type { Question, Requirement } from "./kit-schema.js";

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

function priorityFor(question: Question, requirementsById: ReadonlyMap<string, Requirement>): number {
  const coversMustHave = question.requirement_ids.some((id) => requirementsById.get(id)?.priority === "must");
  return (coversMustHave ? 100 : 0) + question.difficulty * 10;
}

export function allocateSchedule(
  requirements: readonly Requirement[],
  questions: readonly Question[],
  daysAvailable: number,
): ScheduleDay[] {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1 || daysAvailable > 60) {
    throw new Error("daysAvailable must be an integer between 1 and 60.");
  }

  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const orderedQuestions = [...questions].sort((left, right) => {
    const priorityDifference = priorityFor(right, requirementsById) - priorityFor(left, requirementsById);
    return priorityDifference || left.id.localeCompare(right.id);
  });
  const days: ScheduleDay[] = Array.from({ length: daysAvailable }, (_, index) => ({
    day: index + 1,
    focus: "Review and reflection",
    question_ids: [],
    minutes: 0,
  }));

  for (const [index, question] of orderedQuestions.entries()) {
    const day = days[index % daysAvailable];
    if (!day) throw new Error("Unable to allocate schedule day.");
    day.question_ids.push(question.id);
    day.minutes += 15 + question.difficulty * 15;
    day.focus = day.question_ids.length === 1 ? question.category : "Mixed interview practice";
  }
  return days;
}
