import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import { generateKitForCase } from "../application/generate-kit.js";
import { evaluationInputSchema, evaluationOutputSchema } from "./contracts.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const inputPath = option("--input");
  const outputPath = option("--output");
  if (!inputPath || !outputPath) {
    throw new Error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  }

  const input = evaluationInputSchema.parse(JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const kits = await Promise.all(input.map(async (item) => {
    try {
      return { id: item.id, status: "ok" as const, kit: await generateKitForCase(item), error: null };
    } catch (error) {
      return {
        id: item.id,
        status: "failed" as const,
        kit: null,
        error: { code: "GENERATION_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      };
    }
  }));
  const output = evaluationOutputSchema.parse({ version: "1.0", generated_at: new Date().toISOString(), kits });
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join("; ") : String(error);
  console.error(message);
  process.exitCode = 1;
});
