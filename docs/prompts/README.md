# Planning prompts

Both files are generated from `shared/src/prompts.ts` (run `npx tsx scripts/write-prompts.mts`; a test fails if they're out of date). Never edit them by hand.

| File | When it's used |
|---|---|
| `generate-plan-prompt.txt` | **Main way.** Pasted into an existing chat where the user has already been discussing their project, plan or product. The assistant plans from the conversation. |
| `generate-plan-prompt-fresh-chat.txt` | A fresh chat. The site's plan wizard (`shared/src/wizard.ts`) fills in the "MY PROJECT NOTES" section from the user's answers. |

## Testing with other AI assistants (plan section 12)

**Existing-chat test (main way):**
1. In ChatGPT, Gemini or Copilot, start a chat and talk about one of the sample projects below for a few messages, the way a real user would (ask for ideas, make a decision or two, mention who's involved, say one thing is already done).
2. Paste all of `generate-plan-prompt.txt` as the next message.
3. Send back the whole conversation's last reply. Each reply becomes a test in `shared/test/fixtures/assistants/`.

**Fresh-chat test:** paste `generate-plan-prompt-fresh-chat.txt` into a new chat with the last line replaced by a sample project.

## Sample projects
1. **Event:** A 200-guest charity dinner in March, budget $50k, raise money for the local food bank. Team: Sam, Ana, Leo.
2. **Renovation:** Redo our kitchen by spring, budget $30k, new cabinets, counters and wiring, needs a permit and inspection.
3. **Product launch:** Launch our new budgeting app in 3 months: website, app store listing, press, beta testers, launch event.
4. **Research:** A 6-month survey study on remote work and sleep: ethics approval, recruit 300 people, analysis, paper.
5. **Hiring:** Hire 3 warehouse supervisors in 8 weeks: job posts, interviews, background checks, onboarding.
