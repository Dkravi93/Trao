import { z } from "zod";
import { kitSchema } from "../domain/kit-schema.js";

export const evaluationCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string().min(1),
  days: z.number().int().min(1).max(60),
});

export const evaluationInputSchema = z.array(evaluationCaseSchema);
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const evaluationOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  kits: z.array(z.object({
    id: z.string(),
    status: z.enum(["ok", "failed"]),
    kit: kitSchema.nullable(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
  })),
});
