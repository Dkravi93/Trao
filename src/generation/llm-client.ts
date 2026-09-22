import { z } from "zod";

const completionSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });
export type LlmProvider = "groq" | "openai" | "compatible";
export interface LlmProviderConfig { provider: LlmProvider; baseUrl: string; apiKey: string; model: string; }

function parseJson(content: string): unknown {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

/** Resolves one vendor at runtime; call sites depend only on this common chat-completions contract. */
export function resolveLlmProvider(env: Partial<NodeJS.ProcessEnv> = process.env): LlmProviderConfig | null {
  const selected = env.LLM_PROVIDER?.toLowerCase();
  const groq = (): LlmProviderConfig | null => env.GROQ_API_KEY && env.GROQ_MODEL ? { provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL } : null;
  const openai = (): LlmProviderConfig | null => env.OPENAI_API_KEY && env.OPENAI_MODEL ? { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL } : null;
  const compatible = (): LlmProviderConfig | null => env.LLM_API_KEY && env.LLM_MODEL && env.LLM_BASE_URL ? { provider: "compatible", baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL } : null;
  if (selected === "groq") return groq();
  if (selected === "openai") return openai();
  if (selected === "compatible") return compatible();
  if (selected) throw new Error("LLM_PROVIDER must be groq, openai, or compatible.");
  return groq() ?? openai() ?? compatible();
}

export class LlmClient {
  private readonly configuration: LlmProviderConfig | null;
  constructor(configuration = resolveLlmProvider()) { this.configuration = configuration; }
  get enabled(): boolean { return this.configuration !== null; }
  get provider(): LlmProvider | null { return this.configuration?.provider ?? null; }

  async json<T>(system: string, prompt: string, schema: z.ZodType<T>, label = "LlmClient"): Promise<T> {
    if (!this.configuration) throw new Error("No LLM provider is configured.");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let content: string | undefined;
      try {
        const response = await fetch(`${this.configuration.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.configuration.apiKey}` },
          body: JSON.stringify({ model: this.configuration.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
        });
        if (!response.ok) throw new Error(`${this.configuration.provider} returned HTTP ${response.status}.`);
        content = completionSchema.parse(await response.json()).choices[0]?.message.content;
        if (!content) throw new Error("LLM returned no message content.");
        return schema.parse(parseJson(content));
      } catch (error) {
        // content is only set once the completion itself succeeded, so this
        // only fires for a genuine shape mismatch (bad JSON or wrong schema),
        // not for network/HTTP failures — exactly the case that was
        // otherwise invisible beyond a zod error path.
        if (content !== undefined) {
          console.warn(`[${label}] response did not match the expected shape (attempt ${attempt + 1}):`, content.slice(0, 800));
        }
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    throw lastError;
  }
}
