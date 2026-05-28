# CLAUDE.md — promptdiff

Development guide for Claude. Read this fully before writing any code.
When in doubt: simpler is correct. If a method needs a comment to explain what it does, rewrite it.

---

## What this project is

`promptdiff` is a CLI tool that compares two prompt versions behaviorally — not just as text.
It runs both prompts against a test suite, scores output quality using LLM-as-judge, and reports
regressions, cost delta, and a single regression score. It is not a prompt management platform.
It is not a red-teaming tool. It does one thing well.

```bash
promptdiff v1.txt v2.txt --suite tests.yaml --model gpt-4o
```

---

## Architecture

### Layer model — never cross these boundaries

```
IO layer        cli/, config/, providers/, reporters/
                Touches the outside world. No business logic.

Core layer      core/differ/, core/runner/, core/judge/, core/scorer/
                Pure functions. No imports from IO or infra layers.
                Fully testable without mocks or network.

Infra layer     infra/cache, infra/errors, infra/logger
                Cross-cutting concerns. Wraps IO, never invoked by core.
```

**Rule:** Core never imports from IO or Infra. IO imports from Core and Infra. Infra imports nothing internal.
Dependency arrows point inward only.

### Module responsibilities (one job each)

| Module | Job | Nothing else |
|---|---|---|
| `cli/` | Parse argv, call orchestrate() | No logic |
| `config/` | Load + validate YAML suite | No defaults that hide mistakes |
| `core/differ` | Text diff + token delta | No LLM calls |
| `core/runner` | Execute test cases against provider | No scoring |
| `core/judge` | Score a pair of RunResults | No aggregation |
| `core/scorer` | Aggregate JudgeResults → DiffReport | No IO |
| `providers/` | Thin adapter per LLM API | No retry logic in adapters |
| `reporters/` | Render DiffReport to terminal or file | No computation |
| `infra/cache` | Wrap Provider with disk cache | Transparent, no logic |
| `infra/errors` | Typed error classes | No catching |
| `infra/logger` | Never-crashing log util | No formatting logic |

### Directory structure

```
src/
  cli/
    index.ts          Entry point. Parses argv, calls orchestrate().
    args.ts           Argument definitions and validation.
  config/
    loader.ts         Reads YAML file, calls schema validator.
    schema.ts         Zod schema for the test suite format.
    types.ts          Config-specific types (re-exported from types.ts).
  core/
    differ/
      differ.ts       computeTextDiff(a, b): TextDiff
      tokenizer.ts    countTokens(text, model): number
    runner/
      runner.ts       runTestSuite(suite, provider): Promise<RunResult[]>
      concurrency.ts  withConcurrencyLimit(tasks, limit): Promise<T[]>
    judge/
      judge.ts        judgeResults(v1, v2, config): Promise<JudgeResult>
      assertions.ts   evaluate(assertion, output): AssertionResult
    scorer/
      scorer.ts       computeReport(results, textDiff): DiffReport
  providers/
    types.ts          Provider interface
    openai.ts         OpenAI adapter
    anthropic.ts      Anthropic adapter
    index.ts          createProvider(model, apiKey): Provider
  reporters/
    types.ts          Reporter interface
    terminal.ts       Renders DiffReport to stdout
  infra/
    cache.ts          CachedProvider — wraps Provider with disk cache
    errors.ts         Typed error classes
    logger.ts         logger.info / warn / error (never throws)
  orchestrate.ts      Wires all modules together. Called by CLI.
  types.ts            All shared types. No logic.
tests/
  unit/               Mirrors src/core/ — one file per module
  integration/        runner + judge together with fixture responses
  fixtures/
    prompts/          Sample v1.txt, v2.txt
    suites/           Sample tests.yaml
    responses/        Canned LLM responses for integration tests
```

---

## Shared types — define these first, code follows

All types live in `src/types.ts`. No type is defined in two places.

```typescript
// The loaded, validated test suite
export type Config = {
  model: string
  judge_model: string
  runs_per_test: number
  concurrency: number
  tests: TestCase[]
}

// One test case from the YAML
export type TestCase = {
  id: string
  input: string
  vars?: Record<string, string>
  assert: Assertion[]
}

// Union of all assertion types — add new types here only
export type Assertion =
  | { type: 'contains';     value: string }
  | { type: 'not_contains'; value: string }
  | { type: 'length_under'; value: number }
  | { type: 'starts_with';  value: string }
  | { type: 'regex';        value: string }
  | { type: 'llm_judge';    criteria: string }

// Raw output from one prompt version on one test case
export type RunResult = {
  testId: string
  version: 'v1' | 'v2'
  output: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
  error?: string
}

// Score for one test case comparing v1 vs v2
export type JudgeResult = {
  testId: string
  verdict: 'pass' | 'warn' | 'fail'
  regressionScore: number     // 0–100, higher = less regression
  assertionResults: AssertionResult[]
  reason?: string             // populated only for llm_judge type
}

export type AssertionResult = {
  assertion: Assertion
  passed: boolean
  version: 'v1' | 'v2' | 'both'
  detail?: string
}

// Text comparison output
export type TextDiff = {
  added: number               // lines added
  removed: number             // lines removed
  tokenDelta: number          // positive = v2 is larger
  tokenDeltaPercent: number
}

// Cost comparison
export type CostDelta = {
  v1AvgCostUsd: number
  v2AvgCostUsd: number
  deltaUsd: number
  deltaPercent: number
}

// Final report — what reporters consume
export type DiffReport = {
  textDiff: TextDiff
  costDelta: CostDelta
  regressionScore: number     // 0–100 aggregate
  verdict: 'pass' | 'warn' | 'fail'
  totalTests: number
  passed: number
  warned: number
  failed: number
  results: JudgeResult[]
}

// Provider interface — all LLM adapters implement this
export interface Provider {
  complete(prompt: string, input: string): Promise<RunResult>
  model: string
}

// Reporter interface — all output formatters implement this
export interface Reporter {
  render(report: DiffReport, v1Path: string, v2Path: string): void
}
```

---

## Coding rules

### Methods

- **One method, one job.** If you cannot name a method without using "and", split it.
- **Max 20 lines per function.** If it grows past this, extract a helper with a precise name.
- **No function parameters beyond 3.** If you need more, pass an options object with a type.
- **No boolean parameters.** `runWithCache(true)` is unreadable. Use `{ useCache: true }` or two named functions.
- **Pure functions in core/.** No side effects, no globals, no Date.now() — pass time in if needed.

### Types

- **No `any`.** If you don't know the type, stop and figure it out. `unknown` + a guard is always the answer.
- **No type assertions (`as Foo`).** Parse with Zod at the boundary, trust types inside.
- **Prefer unions over booleans for state.** `verdict: 'pass' | 'warn' | 'fail'` not `passed: boolean, warned: boolean`.
- **Never re-declare types.** All shared types live in `src/types.ts`. Module-local types live in that module's `types.ts`.

### Error handling

- **Typed errors only.** Every error class lives in `src/infra/errors.ts`.
  ```typescript
  export class ConfigError   extends Error { readonly _tag = 'ConfigError'   }
  export class ProviderError extends Error { readonly _tag = 'ProviderError' }
  export class CacheError    extends Error { readonly _tag = 'CacheError'    }
  ```
- **Core never throws.** Functions in core/ return `Result<T, E>` for expected failures.
  Use a simple discriminated union — no external Result library needed:
  ```typescript
  type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
  ```
- **IO layers throw typed errors.** Catch at the CLI boundary only, in `cli/index.ts`.
- **Never swallow errors.** No empty catch blocks. No `catch (e) { return null }`.

### Naming

- **Variables:** what they contain, not their type. `testResults` not `resultsArray`.
- **Functions:** verb + noun. `computeTextDiff`, `loadConfig`, `renderReport`.
- **Booleans:** `is`, `has`, `can` prefix. `isValid`, `hasErrors`, `canRetry`.
- **No abbreviations** except universally known ones (`id`, `url`, `ms`, `Usd`).
- **Types and interfaces:** PascalCase nouns. `DiffReport`, `Provider`, `TestCase`.

### Imports

- **No circular imports.** If you need to import from a sibling, you have a layering mistake.
- **Explicit imports only.** No barrel re-exports that hide where things come from.
- **External dependencies last** in import order. Stdlib → internal → external.

### Comments

- **No comments that describe what code does.** The code should say that.
- **Comments explain why**, not what. Document intent, constraints, tradeoffs.
- **Every exported function/type gets a one-line JSDoc.** No multi-line novels.

---

## The orchestrator — `src/orchestrate.ts`

This is the only place that wires modules together. It calls them in order.
Nothing calls orchestrate except the CLI. No module calls another module directly.

```typescript
export async function orchestrate(
  v1Path: string,
  v2Path: string,
  suitePath: string,
  options: OrchestrateOptions
): Promise<DiffReport> {

  const config   = await loadConfig(suitePath)
  const v1       = await readPromptFile(v1Path)
  const v2       = await readPromptFile(v2Path)

  const textDiff = computeTextDiff(v1, v2, config.model)

  const provider = createProvider(options.model ?? config.model, options.apiKey)
  const cached   = options.noCache ? provider : new CachedProvider(provider)

  const [v1Results, v2Results] = await Promise.all([
    runTestSuite(config, v1, 'v1', cached),
    runTestSuite(config, v2, 'v2', cached),
  ])

  const judgeProvider  = createProvider(config.judge_model, options.apiKey)
  const judgeResults   = await judgeAllResults(v1Results, v2Results, config, judgeProvider)

  const report = computeReport(judgeResults, textDiff, v1Results, v2Results)

  const reporter = createReporter(options.format ?? 'terminal')
  reporter.render(report, v1Path, v2Path)

  return report
}
```

**Rules for orchestrate.ts:**
- No business logic — only sequencing.
- No conditional branches beyond option defaults.
- Every step's result is passed explicitly to the next — no shared mutable state.

---

## Providers — `src/providers/`

All LLM adapters implement the `Provider` interface. The adapter's only job is the API call.

```typescript
// src/providers/types.ts
export interface Provider {
  readonly model: string
  complete(prompt: string, input: string): Promise<RunResult>
}
```

**Rules for providers:**
- No retry logic inside adapters. Retry wraps the provider from outside if needed.
- No caching inside adapters. CachedProvider wraps from outside.
- Catch API errors and re-throw as `ProviderError` with the original message preserved.
- Cost calculation happens in the adapter — it knows the pricing for its own models.

```typescript
// src/providers/openai.ts — full example
export class OpenAIProvider implements Provider {
  readonly model: string

  constructor(model: string, private readonly client: OpenAI) {
    this.model = model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const start = Date.now()
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user',   content: input  },
        ],
      })
      const output = res.choices[0]?.message?.content ?? ''
      const inputTokens  = res.usage?.prompt_tokens     ?? 0
      const outputTokens = res.usage?.completion_tokens ?? 0
      return {
        testId: '',               // caller fills this in
        version: 'v1',            // caller fills this in
        output,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - start,
        costUsd: computeCost(this.model, inputTokens, outputTokens),
      }
    } catch (err) {
      throw new ProviderError(`OpenAI call failed: ${String(err)}`)
    }
  }
}
```

---

## Assertions — `src/core/judge/assertions.ts`

Assertions are data. A single `evaluate` function dispatches on type.
Adding a new assertion type = add a branch here and add the type to the union in `types.ts`.
Do not create a class per assertion type.

```typescript
export function evaluate(assertion: Assertion, output: string): AssertionResult {
  switch (assertion.type) {
    case 'contains':
      return pass(assertion, output.includes(assertion.value))
    case 'not_contains':
      return pass(assertion, !output.includes(assertion.value))
    case 'length_under':
      return pass(assertion, output.length < assertion.value)
    case 'starts_with':
      return pass(assertion, output.trimStart().startsWith(assertion.value))
    case 'regex':
      return pass(assertion, new RegExp(assertion.value).test(output))
    case 'llm_judge':
      // LLM judge assertions are handled separately in judge.ts
      // They require async and a provider — keep evaluate() synchronous
      throw new Error('llm_judge assertions must be evaluated via judgeWithLLM()')
  }
}

function pass(assertion: Assertion, passed: boolean): AssertionResult {
  return { assertion, passed, version: 'both' }
}
```

**Rule:** `evaluate()` is synchronous. Any assertion requiring an LLM call is handled in `judge.ts`
as a separate code path. Never mix sync and async assertion evaluation.

---

## Cache — `src/infra/cache.ts`

CachedProvider is a decorator. It wraps any Provider and is transparent to callers.

```typescript
export class CachedProvider implements Provider {
  readonly model: string

  constructor(private readonly inner: Provider, private readonly dir = '.promptdiff-cache') {
    this.model = inner.model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const key    = hashKey(this.model, prompt, input)
    const cached = await this.read(key)
    if (cached) return cached

    const result = await this.inner.complete(prompt, input)
    await this.write(key, result)
    return result
  }

  private async read(key: string): Promise<RunResult | null> { ... }
  private async write(key: string, result: RunResult): Promise<void> { ... }
}

function hashKey(model: string, prompt: string, input: string): string {
  return createHash('sha256').update(`${model}:${prompt}:${input}`).digest('hex').slice(0, 16)
}
```

**Rules for cache:**
- Cache directory is `.promptdiff-cache/` at the cwd. Gitignored.
- Cache key is sha256 of `model + prompt + input`. Never include timestamps.
- A cache miss is not an error. A write failure logs a warning and continues.
- Cache is bypassed entirely with `--no-cache` flag.

---

## Runner — `src/core/runner/runner.ts`

Runs one prompt version against all test cases. Returns raw RunResult[].
Does not score or judge — just execute.

```typescript
export async function runTestSuite(
  config: Config,
  prompt: string,
  version: 'v1' | 'v2',
  provider: Provider
): Promise<RunResult[]> {
  const tasks = config.tests.map(test => () => runOneTest(test, prompt, version, provider))
  return withConcurrencyLimit(tasks, config.concurrency)
}

async function runOneTest(
  test: TestCase,
  prompt: string,
  version: 'v1' | 'v2',
  provider: Provider
): Promise<RunResult> {
  const input  = interpolateVars(test.input, test.vars ?? {})
  const result = await provider.complete(prompt, input)
  return { ...result, testId: test.id, version }
}

function interpolateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
```

**Rules for runner:**
- `runs_per_test` averaging happens here — run N times, average tokens and cost, use last output.
- `concurrency` is applied across all tests, not per-test. Never spawn more than config.concurrency calls.
- A failed test (network error, timeout) returns a RunResult with `error` set, not a thrown exception.

---

## Config — `src/config/schema.ts`

Validate with Zod at load time. If the YAML is invalid, fail immediately with a clear message.
Never silently apply defaults that hide configuration mistakes.

```typescript
import { z } from 'zod'

const AssertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('contains'),     value: z.string() }),
  z.object({ type: z.literal('not_contains'), value: z.string() }),
  z.object({ type: z.literal('length_under'), value: z.number().positive() }),
  z.object({ type: z.literal('starts_with'),  value: z.string() }),
  z.object({ type: z.literal('regex'),        value: z.string() }),
  z.object({ type: z.literal('llm_judge'),    criteria: z.string() }),
])

const TestCaseSchema = z.object({
  id:     z.string().min(1),
  input:  z.string().min(1),
  vars:   z.record(z.string()).optional(),
  assert: z.array(AssertionSchema).min(1),
})

export const ConfigSchema = z.object({
  model:          z.string(),
  judge_model:    z.string().default('gpt-4o-mini'),
  runs_per_test:  z.number().int().min(1).max(10).default(1),
  concurrency:    z.number().int().min(1).max(20).default(5),
  tests:          z.array(TestCaseSchema).min(1),
})

export type Config = z.infer<typeof ConfigSchema>
```

---

## Test suite YAML format (reference)

```yaml
# tests.yaml
model: gpt-4o
judge_model: gpt-4o-mini   # cheap model for grading
runs_per_test: 3            # average over N runs per test
concurrency: 5              # max parallel API calls

tests:
  - id: basic_summary
    input: "Summarize this: {{text}}"
    vars:
      text: "The water cycle describes how water evaporates..."
    assert:
      - type: length_under
        value: 200
      - type: llm_judge
        criteria: "Is factually accurate and concise"

  - id: tone_check
    input: "Reply to this angry customer: I've been waiting 3 weeks!"
    assert:
      - type: not_contains
        value: "unfortunately"
      - type: llm_judge
        criteria: "Is calm, professional, and apologetic"

  - id: format_check
    input: "List 3 benefits of exercise"
    assert:
      - type: contains
        value: "1."
      - type: length_under
        value: 300
```

---

## CLI — `src/cli/index.ts`

Entry point only. Zero logic. Calls orchestrate and handles the exit code.

```typescript
import { Command } from 'commander'
import { orchestrate } from '../orchestrate.js'
import { ConfigError, ProviderError } from '../infra/errors.js'

const program = new Command()
  .name('promptdiff')
  .description('Compare two prompt versions behaviorally')
  .argument('<v1>', 'Path to first prompt file')
  .argument('<v2>', 'Path to second prompt file')
  .requiredOption('-s, --suite <path>', 'Path to test suite YAML')
  .option('-m, --model <name>', 'Override model from suite')
  .option('--min-score <n>', 'Exit 1 if regression score below this', parseInt)
  .option('--no-cache', 'Skip cache, always call API')
  .option('--format <type>', 'Output format: terminal | json', 'terminal')
  .action(async (v1, v2, options) => {
    try {
      const report = await orchestrate(v1, v2, options.suite, options)
      const exitCode = options.minScore && report.regressionScore < options.minScore ? 1 : 0
      process.exit(exitCode)
    } catch (err) {
      if (err instanceof ConfigError)   { console.error(`Config error: ${err.message}`);   process.exit(2) }
      if (err instanceof ProviderError) { console.error(`Provider error: ${err.message}`); process.exit(3) }
      console.error(`Unexpected error: ${String(err)}`)
      process.exit(1)
    }
  })

program.parse()
```

**Exit codes:**
- `0` — success, score above threshold
- `1` — regression score below `--min-score`
- `2` — config/file error
- `3` — provider API error

---

## Testing rules

- **Every function in `core/` has a unit test.** No exceptions.
- **Integration tests use fixture responses.** Never make real API calls in tests.
- **One test file per source file.** `core/differ/differ.ts` → `tests/unit/differ.test.ts`.
- **Test names describe behavior, not implementation:**
  - ✓ `computeTextDiff returns zero delta for identical prompts`
  - ✗ `test computeTextDiff`
- **No test helpers shared across modules.** Each test is self-contained.
- **Use `vitest`.** Fast, native TypeScript, no config needed.

```typescript
// Example — tests/unit/differ.test.ts
import { describe, it, expect } from 'vitest'
import { computeTextDiff } from '../../src/core/differ/differ.js'

describe('computeTextDiff', () => {
  it('returns zero delta for identical prompts', () => {
    const result = computeTextDiff('same', 'same', 'gpt-4o')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.tokenDelta).toBe(0)
  })

  it('counts added lines correctly', () => {
    const result = computeTextDiff('line one', 'line one\nline two', 'gpt-4o')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
  })
})
```

---

## Dependencies (minimal — add nothing without a reason)

```json
{
  "dependencies": {
    "commander":     "^12",   // CLI arg parsing
    "chalk":         "^5",    // terminal colors
    "js-yaml":       "^4",    // YAML parsing
    "zod":           "^3",    // runtime validation
    "tiktoken":      "^1",    // token counting
    "openai":        "^4",    // OpenAI SDK
    "@anthropic-ai/sdk": "^0.24", // Anthropic SDK
    "p-limit":       "^5"     // concurrency control
  },
  "devDependencies": {
    "vitest":         "^1",
    "typescript":     "^5",
    "@types/node":    "^20",
    "@types/js-yaml": "^4"
  }
}
```

**Rule:** Before adding a dependency, confirm it cannot be done in ~20 lines of stdlib code.
`p-limit` is worth it (concurrency is subtle). A full HTTP client library is not (use `fetch`).

---

## Environment variables

```
OPENAI_API_KEY      Required for OpenAI models
ANTHROPIC_API_KEY   Required for Anthropic models
PROMPTDIFF_CACHE_DIR  Override cache directory (default: .promptdiff-cache)
```

Never read env vars inside core modules. Read them once in `cli/index.ts` or `orchestrate.ts`
and pass them down explicitly.

---

## Implementing a new assertion type (example workflow)

1. Add the type to the `Assertion` union in `src/types.ts`
2. Add the Zod schema branch in `src/config/schema.ts`
3. Add the case to `evaluate()` in `src/core/judge/assertions.ts`
4. Add a unit test in `tests/unit/judge/assertions.test.ts`
5. Update the YAML format reference in this file

That is the complete change surface. No other files should change.

---

## Implementing a new provider (example workflow)

1. Create `src/providers/{name}.ts` implementing `Provider`
2. Add the model prefix to `createProvider()` in `src/providers/index.ts`
3. Add the API key env var to the Environment Variables section above
4. Add the pricing table entry to the cost calculation helper
5. Add integration test with fixture response in `tests/integration/`

---

## What not to build (scope guard)

The following are explicitly out of scope for v1. Do not add them.

- Web UI or dashboard
- Prompt storage or versioning database
- Real-time streaming output comparison
- Multi-agent or chain evaluation
- Automatic test case generation (promptdiff init — v2)
- HTML report (v2)
- Homebrew distribution (after npm is stable)

If a feature request fits one of these, note it and move on.
Build the core loop first. Scope creep is the most common cause of never shipping.

---

## Definition of done for v1

The tool is done when:

- [ ] `promptdiff v1.txt v2.txt --suite tests.yaml` runs end-to-end
- [ ] All deterministic assertion types work
- [ ] `llm_judge` assertion works with gpt-4o-mini
- [ ] Cost delta is shown in terminal output
- [ ] Regression score (0–100) is computed and displayed
- [ ] `--min-score` flag exits with code 1 when score is below threshold
- [ ] Cache works — second run is instant with no API calls
- [ ] `--no-cache` bypasses cache
- [ ] Works with OpenAI and Anthropic models
- [ ] All core/ functions have unit tests
- [ ] Integration test runs against fixture responses (no real API calls)
- [ ] Published to npm as `promptdiff`
- [ ] README has a 60-second quickstart
