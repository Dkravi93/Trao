import { z } from "zod";

const completionSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

function parseJson(content: string): unknown {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(withoutFence);
}

export class LlmClient {
  private readonly baseUrl = process.env.LLM_BASE_URL;
  private readonly apiKey = process.env.LLM_API_KEY;
  private readonly model = process.env.LLM_MODEL;

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  async json<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
    if (!this.enabled) throw new Error("LLM provider is not configured.");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl?.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
        });
        if (!response.ok) throw new Error(`LLM returned HTTP ${response.status}.`);
        const content = completionSchema.parse(await response.json()).choices[0]?.message.content;
        if (!content) throw new Error("LLM returned no message content.");
        return schema.parse(parseJson(content));
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    throw lastError;
  }
}
