import assert from "node:assert/strict";
import test from "node:test";
import { allocateSchedule } from "./schedule.js";
import type { Question, Requirement } from "./kit-schema.js";

test("creates exactly the requested days and puts must-have material first", () => {
  const requirements: Requirement[] = [
    { id: "r1", text: "React", kind: "technical", priority: "must" },
    { id: "r2", text: "Communication", kind: "behavioural", priority: "nice" },
  ];
  const questions: Question[] = [
    { id: "q1", requirement_ids: ["r2"], category: "behavioural", prompt: "p", answer_outline: "", difficulty: 3 },
    { id: "q2", requirement_ids: ["r1"], category: "technical", prompt: "p", answer_outline: "", difficulty: 1 },
  ];
  const schedule = allocateSchedule(requirements, questions, 3);
  assert.equal(schedule.length, 3);
  assert.deepEqual(schedule[0]?.question_ids, ["q2"]);
  assert.ok(schedule.every((day) => Number.isInteger(day.minutes)));
});
