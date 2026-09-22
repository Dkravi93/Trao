import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./passwords.js";

test("hashes passwords with a unique salt and verifies only the correct password", async () => {
  const first = await hashPassword("a long enough test password");
  const second = await hashPassword("a long enough test password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("a long enough test password", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});
