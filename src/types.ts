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
