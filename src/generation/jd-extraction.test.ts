import assert from "node:assert/strict";
import test from "node:test";
import { extractRoleFromJobDescription } from "./jd-extraction.js";

test("extracts explicit requirements without manufacturing requirements for a thin posting", () => {
  const role = extractRoleFromJobDescription(`Senior Frontend Engineer\nRequirements:\n- 5+ years of TypeScript and React experience\n- Must mentor junior engineers\n- GraphQL experience is preferred`);
  assert.equal(role.requirements.length, 3);
  assert.deepEqual(role.requirements.map((requirement) => requirement.priority), ["must", "must", "nice"]);
  assert.deepEqual(role.requirements.map((requirement) => requirement.kind), ["technical", "behavioural", "technical"]);
  assert.deepEqual(extractRoleFromJobDescription("Engineer wanted").requirements, []);
});
