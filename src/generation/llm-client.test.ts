import assert from "node:assert/strict";
import test from "node:test";
import { resolveLlmProvider } from "./llm-client.js";

test("selects the requested Groq, OpenAI, or generic compatible provider", () => {
  assert.deepEqual(resolveLlmProvider({ LLM_PROVIDER: "groq", GROQ_API_KEY: "key", GROQ_MODEL: "model" }), { provider: "groq", apiKey: "key", model: "model", baseUrl: "https://api.groq.com/openai/v1" });
  assert.deepEqual(resolveLlmProvider({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "key", OPENAI_MODEL: "model" }), { provider: "openai", apiKey: "key", model: "model", baseUrl: "https://api.openai.com/v1" });
  assert.deepEqual(resolveLlmProvider({ LLM_API_KEY: "key", LLM_MODEL: "model", LLM_BASE_URL: "https://provider.example/v1" }), { provider: "compatible", apiKey: "key", model: "model", baseUrl: "https://provider.example/v1" });
});
