import type {
  Assertion, AssertionResult, Config, JudgeResult, Provider, RunResult, TestCase, Verdict,
} from '../../types.js'
import { evaluate } from './assertions.js'
import { withConcurrencyLimit } from '../runner/concurrency.js'

const PASS_THRESHOLD = 90
const WARN_THRESHOLD = 70

type AssertionEvaluation = {
  score: number
  results: AssertionResult[]
  reason?: string
}

/** Score one (v1, v2) result pair against the test's assertions, returning a JudgeResult. */
export async function judgeResults(
  v1: RunResult,
  v2: RunResult,
  test: TestCase,
  judgeProvider: Provider,
): Promise<JudgeResult> {
  const evaluations = await evaluateAllAssertions(test.assert, v1.output, v2.output, judgeProvider)
  const regressionScore = aggregateScore(evaluations)
  const verdict = verdictForPair(regressionScore, v2.error)
  const reason = collectReasons(evaluations)

  const result: JudgeResult = {
    testId: test.id,
    verdict,
    regressionScore,
    assertionResults: evaluations.flatMap(e => e.results),
  }
  if (reason !== undefined) result.reason = reason
  return result
}

/** Pair v1 and v2 results by testId and judge each pair in parallel (bounded by config.concurrency). */
export async function judgeAllResults(
  v1Results: RunResult[],
  v2Results: RunResult[],
  config: Config,
  judgeProvider: Provider,
): Promise<JudgeResult[]> {
  const v1ById = new Map(v1Results.map(r => [r.testId, r]))
  const v2ById = new Map(v2Results.map(r => [r.testId, r]))
  const tasks: Array<() => Promise<JudgeResult>> = []

  for (const test of config.tests) {
    const v1 = v1ById.get(test.id)
    const v2 = v2ById.get(test.id)
    if (!v1 || !v2) continue
    tasks.push(() => judgeResults(v1, v2, test, judgeProvider))
  }

  return withConcurrencyLimit(tasks, config.concurrency)
}

async function evaluateAllAssertions(
  assertions: Assertion[],
  v1Output: string,
  v2Output: string,
  judgeProvider: Provider,
): Promise<AssertionEvaluation[]> {
  const out: AssertionEvaluation[] = []
  for (const a of assertions) {
    if (a.type === 'llm_judge') {
      out.push(await runLlmJudge(a, v1Output, v2Output, judgeProvider))
    } else {
      out.push(evaluateDeterministic(a, v1Output, v2Output))
    }
  }
  return out
}

function evaluateDeterministic(
  assertion: Exclude<Assertion, { type: 'llm_judge' }>,
  v1Output: string,
  v2Output: string,
): AssertionEvaluation {
  const r1 = evaluate(assertion, v1Output)
  const r2 = evaluate(assertion, v2Output)
  return {
    score: deterministicScore(r1.passed, r2.passed),
    results: [
      { ...r1, version: 'v1' },
      { ...r2, version: 'v2' },
    ],
  }
}

function deterministicScore(v1Passed: boolean, v2Passed: boolean): number {
  if (v2Passed) return 100        // v2 holds or improves — no regression
  if (!v1Passed) return 100       // both fail — no regression introduced by v2
  return 0                        // v2 broke an assertion v1 passed
}

async function runLlmJudge(
  assertion: Assertion & { type: 'llm_judge' },
  v1Output: string,
  v2Output: string,
  judgeProvider: Provider,
): Promise<AssertionEvaluation> {
  const prompt = JUDGE_SYSTEM_PROMPT
  const input = buildJudgeInput(assertion.criteria, v1Output, v2Output)

  let raw: string
  try {
    const response = await judgeProvider.complete(prompt, input)
    raw = response.output
  } catch (err) {
    return judgeFailure(assertion, `judge call failed: ${(err as Error).message}`)
  }

  const parsed = parseJudgeResponse(raw)
  if (!parsed) {
    return judgeFailure(assertion, `judge response was not valid JSON: ${raw.slice(0, 100)}`)
  }

  return {
    score: parsed.scoreB,
    results: [
      { assertion, passed: parsed.scoreA >= 60, version: 'v1', detail: `score ${parsed.scoreA}` },
      { assertion, passed: parsed.scoreB >= 60, version: 'v2', detail: `score ${parsed.scoreB}` },
    ],
    reason: parsed.reason,
  }
}

const JUDGE_SYSTEM_PROMPT = [
  'You are an impartial judge comparing two AI assistant outputs against a criterion.',
  'Respond ONLY with a single JSON object of this exact shape:',
  '{"winner":"A"|"B"|"tie","scoreA":0-100,"scoreB":0-100,"reason":"<one sentence>"}',
  'No prose, no markdown fences, no explanation outside the JSON.',
].join('\n')

function buildJudgeInput(criteria: string, v1: string, v2: string): string {
  return `Criterion: ${criteria}\n\nOutput A:\n${v1}\n\nOutput B:\n${v2}`
}

type JudgeResponse = { winner: 'A' | 'B' | 'tie'; scoreA: number; scoreB: number; reason: string }

function parseJudgeResponse(raw: string): JudgeResponse | null {
  const stripped = stripMarkdownFence(raw).trim()
  try {
    const parsed = JSON.parse(stripped) as unknown
    return isJudgeResponse(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stripMarkdownFence(s: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(s)
  return match?.[1] ?? s
}

function isJudgeResponse(value: unknown): value is JudgeResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (v.winner === 'A' || v.winner === 'B' || v.winner === 'tie')
    && typeof v.scoreA === 'number'
    && typeof v.scoreB === 'number'
    && typeof v.reason === 'string'
}

function judgeFailure(assertion: Assertion, message: string): AssertionEvaluation {
  return {
    score: 0,
    results: [{ assertion, passed: false, version: 'both', detail: message }],
    reason: message,
  }
}

function aggregateScore(evaluations: AssertionEvaluation[]): number {
  if (evaluations.length === 0) return 100
  const total = evaluations.reduce((sum, e) => sum + e.score, 0)
  return Math.round(total / evaluations.length)
}

function verdictForPair(score: number, runError: string | undefined): Verdict {
  if (runError) return 'fail'
  if (score >= PASS_THRESHOLD) return 'pass'
  if (score >= WARN_THRESHOLD) return 'warn'
  return 'fail'
}

function collectReasons(evaluations: AssertionEvaluation[]): string | undefined {
  const reasons = evaluations.map(e => e.reason).filter((r): r is string => Boolean(r))
  return reasons.length > 0 ? reasons.join('; ') : undefined
}
