import assert from "node:assert/strict";
import test from "node:test";
import { findUncoveredMustHaveRequirements } from "./coverage.js";
import type { Question, Requirement } from "./kit-schema.js";

test("reports only must-have requirements without a matching question", () => {
  const requirements: Requirement[] = [
    { id: "r1", text: "TypeScript", kind: "technical", priority: "must" },
    { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
    { id: "r3", text: "GraphQL", kind: "technical", priority: "nice" },
  ];
  const questions: Question[] = [{ id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "p", answer_outline: "", difficulty: 2 }];
  assert.deepEqual(findUncoveredMustHaveRequirements(requirements, questions), ["r2"]);
});
