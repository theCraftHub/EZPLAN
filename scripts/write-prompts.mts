// Regenerates the copy-paste prompt files in docs/prompts from shared/src/prompts.ts.
// Run: npx tsx scripts/write-prompts.mts   (a test fails if these files are out of date)
import { writeFileSync } from "node:fs";
import { generatePrompt } from "../shared/src/index.ts";
writeFileSync("docs/prompts/generate-plan-prompt.txt", generatePrompt() + "\n");
writeFileSync("docs/prompts/generate-plan-prompt-fresh-chat.txt", generatePrompt({ source: "notes" }) + "\n");
