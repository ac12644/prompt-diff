/** Loaded and validated test suite. */
export type Config = {
  model: string
  judge_model: string
  runs_per_test: number
  concurrency: number
  tests: TestCase[]
}

/** One test case from the YAML. */
export type TestCase = {
  id: string
  input: string
  vars?: Record<string, string>
  assert: Assertion[]
}

/** Union of all assertion types. Add new types here only. */
export type Assertion =
  | { type: 'contains';     value: string }
  | { type: 'not_contains'; value: string }
  | { type: 'length_under'; value: number }
  | { type: 'starts_with';  value: string }
  | { type: 'regex';        value: string }
  | { type: 'llm_judge';    criteria: string }

/** Raw output from one prompt version on one test case. */
export type RunResult = {
  testId: string
  version: Version
  output: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
  error?: string
}

/** Which prompt version a result belongs to. */
export type Version = 'v1' | 'v2'

/** Verdict tier used at both the per-test and aggregate level. */
export type Verdict = 'pass' | 'warn' | 'fail'

/** Score for one test case comparing v1 vs v2. */
export type JudgeResult = {
  testId: string
  verdict: Verdict
  regressionScore: number
  assertionResults: AssertionResult[]
  reason?: string
}

/** Result of evaluating a single assertion. */
export type AssertionResult = {
  assertion: Assertion
  passed: boolean
  version: Version | 'both'
  detail?: string
}

/** Text comparison output. */
export type TextDiff = {
  added: number
  removed: number
  tokenDelta: number
  tokenDeltaPercent: number
}

/** Cost comparison. */
export type CostDelta = {
  v1AvgCostUsd: number
  v2AvgCostUsd: number
  deltaUsd: number
  deltaPercent: number
}

/** Final report — what reporters consume. */
export type DiffReport = {
  textDiff: TextDiff
  costDelta: CostDelta
  regressionScore: number
  verdict: Verdict
  totalTests: number
  passed: number
  warned: number
  failed: number
  results: JudgeResult[]
}

/** Provider interface — all LLM adapters implement this. */
export interface Provider {
  readonly model: string
  complete(prompt: string, input: string): Promise<RunResult>
}

/** Reporter interface — all output formatters implement this. */
export interface Reporter {
  render(report: DiffReport, v1Path: string, v2Path: string): void
}

/** API keys for each supported provider; only the one(s) you use need be set. */
export type ProviderKeys = {
  openai?: string
  anthropic?: string
  gemini?: string
}

/** Options passed from CLI/library callers to orchestrate(). */
export type OrchestrateOptions = {
  model?: string
  apiKeys?: ProviderKeys
  noCache?: boolean
  format?: 'terminal' | 'json'
  cacheDir?: string
}

/** Discriminated Result for core functions that signal expected failure. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/** Per-test summary of what the baseline got wrong, used to prompt the rewriter. */
export type WeaknessSummary = {
  testId: string
  input: string
  output: string
  failedAssertions: string[]   // human-readable, e.g. 'contains "thanks"'
}

/** End-to-end output of `promptdiff suggest`. */
export type SuggestionReport = {
  originalPrompt: string
  suggestedPrompt: string
  suggesterModel: string
  weaknesses: WeaknessSummary[]
  baselineResults: RunResult[]
  suggestionResults: RunResult[]
  diff: DiffReport             // suggestion (as v2) judged against original (as v1)
  accepted: boolean            // diff.verdict === 'pass' and score ≥ minImprovement
}

/** Options for orchestrateSuggest(). */
export type SuggestOptions = {
  apiKeys?: ProviderKeys
  suggesterModel?: string      // override the rewriter model (default: claude-opus-4-7)
  outputPath?: string          // where to write the suggested prompt (default: stdout-only)
  minImprovement?: number      // accept only if diff score ≥ this (default: 90 — same as 'pass')
  noCache?: boolean
  cacheDir?: string
  format?: 'terminal' | 'json'
}
