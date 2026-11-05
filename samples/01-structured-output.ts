/**
 * EXCERPT: structured Claude output validated with Zod.
 *
 * What it shows: the move planner asks Claude for a list of tasks only.
 * The SDK's `messages.parse()` with `zodOutputFormat()` constrains the
 * response to the Zod schema and returns it parsed and typed. Everything
 * the model could get wrong (ids, dates, totals) is computed in code, and
 * a claims guard runs over the tasks before they are saved. The long
 * system prompt is cached with `cache_control: ephemeral`.
 *
 * Excerpt from a private codebase, lightly trimmed. Trims are marked
 * `// ...`. The system prompt itself is omitted.
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
// ... imports of the plan types, the house style rules and the claims guard

/**
 * Zod schema for what we ask Claude to return. We only ask for the tasks
 * array. Everything else (id, moveDateISO, estimatedTotalCostGBP,
 * generatedAt) is computed server-side so Claude can't get it wrong.
 *
 * Nullable fields are used instead of optional because structured outputs
 * requires every property to be present in the response (JSON Schema
 * `additionalProperties: false` + all keys required).
 */
const PlanTaskSchema = z.object({
  title: z.string().describe("Short task title, 5-10 words max"),
  // Descriptions were averaging 517 characters, about 80% of the output,
  // and generation took 52 to 64 seconds against a 75 second client
  // timeout (production logs, 15 October 2026). Output length is what
  // sets the wait, so the cap here is the speed fix.
  description: z
    .string()
    .describe(
      "One or two sentences, at most 220 characters, of specific, actionable guidance for the UK to UAE corridor. Name the exact organisation, fee in AED or GBP, or UAE process; no preamble and no restating the title."
    ),
  category: z.enum(["visa", "career", "housing", "banking", "logistics", "schools", "healthcare", "admin"]),
  dueOffsetDays: z
    .number()
    .int()
    .describe(
      "Days BEFORE arrival (positive) or AFTER arrival (negative). e.g., 120 = do this 120 days before moving; -14 = do this 14 days after landing."
    ),
  estimatedCostGBP: z.number().nullable().describe("Estimated cost in GBP, or null if no direct cost"),
  estimatedCostAED: z.number().nullable().describe("Estimated cost in AED, or null if no direct cost"),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  aiAction: z
    .string()
    .nullable()
    .describe(
      "Description of the AI 'Do it for me' action, or null if the task can't be meaningfully automated by AI (e.g. physical appointments)."
    ),
});

const PlanOutputSchema = z.object({
  tasks: z.array(PlanTaskSchema).min(15).max(35),
});

// ... SYSTEM_PROMPT (long and stable, so it is the part worth caching)
// ... buildUserMessage(input): the user's answers as labelled lines

export async function generatePlanWithClaude(input: PlanInput): Promise<Plan> {
  const apiKey = process.env.ANTHROPIC_API_KEY; // ... (the original also reads an app-specific key name first)
  // Fail inside the function's time budget instead of being killed by
  // it. No automatic retry: a second ~40s attempt cannot fit.
  const client = new Anthropic({ apiKey, timeout: 75_000, maxRetries: 0 });

  const moveDate = new Date();
  moveDate.setMonth(moveDate.getMonth() + monthsFor(input.timeline));

  // Haiku 4.5, chosen for output-generation speed, not thinking depth:
  // larger models generated the ~6k tokens of plan output too slowly to
  // fit the hosting plan's 60s function ceiling.
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(input) }],
    output_config: { format: zodOutputFormat(PlanOutputSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`Plan generation returned no structured output. stop_reason=${response.stop_reason}`);
  }

  return planFromModelTasks(input, response.parsed_output.tasks, moveDate);
}

/**
 * The plan from the model's tasks: dashes stripped, the claims guard run
 * before the plan is returned and saved, then sorted and totalled.
 * Exported for the tests.
 */
export function planFromModelTasks(
  input: PlanInput,
  modelTasks: z.infer<typeof PlanOutputSchema>["tasks"],
  moveDate: Date
): Plan {
  // The model still writes ranges with dashes despite the house style.
  const mapped: PlanTask[] = stripDashesDeep(modelTasks).map((t) => ({
    id: randomUUID(),
    ...t, // ... (the original copies each field, turning null into undefined)
  }));
  const tasks = guardPlanTasks(mapped, input.uaeCity);

  // Sort: urgent first, then earliest-due first within each priority.
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const p = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (p !== 0) return p;
    return b.dueOffsetDays - a.dueOffsetDays;
  });

  const estimatedTotalCostGBP = tasks.reduce((sum, t) => sum + (t.estimatedCostGBP ?? 0), 0);

  return {
    id: randomUUID(),
    input,
    moveDateISO: moveDate.toISOString(),
    tasks,
    generatedAt: new Date().toISOString(),
    estimatedTotalCostGBP,
  };
}
