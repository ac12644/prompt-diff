import type { Assertion, RunResult, TestCase, WeaknessSummary } from '../../types.js'
import { evaluate } from '../judge/assertions.js'

/**
 * Identify which assertions the baseline failed on, per test case. Used to
 * focus the rewriter's attention on what's actually broken rather than asking
 * it to rewrite for everything.
 *
 * `llm_judge` assertions are excluded — they're comparative (v1 vs v2) and
 * have no meaningful single-output verdict. The deterministic assertions are
 * the load-bearing signal for "this prompt is failing X."
 */
export function analyzeWeaknesses(
  tests: TestCase[],
  baselineResults: RunResult[],
): WeaknessSummary[] {
  const resultById = new Map(baselineResults.map(r => [r.testId, r]))
  const summaries: WeaknessSummary[] = []

  for (const test of tests) {
    const result = resultById.get(test.id)
    if (!result) continue
    const failed = collectDeterministicFailures(test.assert, result.output)
    if (failed.length === 0) continue
    summaries.push({
      testId: test.id,
      input: test.input,
      output: result.output,
      failedAssertions: failed,
    })
  }
  return summaries
}

function collectDeterministicFailures(assertions: Assertion[], output: string): string[] {
  const failures: string[] = []
  for (const assertion of assertions) {
    if (assertion.type === 'llm_judge') continue
    const result = evaluate(assertion, output)
    if (!result.passed) failures.push(describeAssertion(assertion))
  }
  return failures
}

function describeAssertion(assertion: Assertion): string {
  switch (assertion.type) {
    case 'contains':     return `must contain "${assertion.value}"`
    case 'not_contains': return `must NOT contain "${assertion.value}"`
    case 'length_under': return `output length must be under ${assertion.value} characters`
    case 'starts_with':  return `output must start with "${assertion.value}"`
    case 'regex':        return `output must match regex /${assertion.value}/`
    case 'llm_judge':    return `judge: ${assertion.criteria}`
  }
}

/** Inputs to a rewrite request. Pure data — the orchestrator turns this into a Provider call. */
export type RewriteRequest = {
  systemPrompt: string
  userInput: string
}

/**
 * Build the prompt sent to the rewriter LLM. The system prompt establishes the
 * role; the user message contains the original prompt, the test inputs/outputs,
 * and the assertion failures.
 */
export function buildRewriteRequest(
  originalPrompt: string,
  tests: TestCase[],
  baselineResults: RunResult[],
  weaknesses: WeaknessSummary[],
): RewriteRequest {
  const weaknessById = new Map(weaknesses.map(w => [w.testId, w]))
  const resultById = new Map(baselineResults.map(r => [r.testId, r]))

  const sections: string[] = []
  sections.push('ORIGINAL PROMPT:')
  sections.push('"""')
  sections.push(originalPrompt.trim())
  sections.push('"""')
  sections.push('')
  sections.push('TEST CASES (how the current prompt handled each one):')
  sections.push('')

  for (const [i, test] of tests.entries()) {
    const result = resultById.get(test.id)
    if (!result) continue
    const failures = weaknessById.get(test.id)?.failedAssertions ?? []
    const judgeCriteria = test.assert
      .filter((a): a is Extract<typeof a, { type: 'llm_judge' }> => a.type === 'llm_judge')
      .map(a => a.criteria.trim())

    sections.push(`Case ${i + 1}: ${test.id}`)
    sections.push(`Input: ${truncate(test.input, 400)}`)
    sections.push(`Current output: ${truncate(result.output, 600)}`)
    if (failures.length > 0) {
      sections.push('FAILED CHECKS:')
      for (const f of failures) sections.push(`  - ${f}`)
    } else {
      sections.push('All deterministic checks PASSED — preserve this behavior.')
    }
    if (judgeCriteria.length > 0) {
      sections.push('JUDGE CRITERIA (a judge LLM scores the output against these):')
      for (const c of judgeCriteria) sections.push(`  - ${truncate(c, 300)}`)
    }
    sections.push('')
  }

  sections.push('Rewrite the original prompt so it satisfies every failed check WITHOUT')
  sections.push('breaking the cases currently passing. Keep the voice, intent, and scope of')
  sections.push('the original. Be concise — do not pad.')

  return { systemPrompt: REWRITER_SYSTEM_PROMPT, userInput: sections.join('\n') }
}

const REWRITER_SYSTEM_PROMPT = [
  'You are a senior prompt engineer. You will be given an existing system prompt,',
  'the test cases it must handle, the actual outputs it produced, and which checks',
  'failed.',
  '',
  'Rewrite the prompt to fix the failures while preserving everything that works.',
  '',
  'Respond ONLY with the rewritten prompt text — no preamble, no markdown fences,',
  'no quotes around it, no explanation of what you changed. The first character of',
  'your response must be the first character of the new prompt.',
].join('\n')

/**
 * Strip common LLM hedging artifacts from a rewriter response:
 *   - markdown fences (```...```)
 *   - "Here's the rewritten prompt:" preambles
 *   - matched surrounding quotes
 */
export function extractRewrittenPrompt(raw: string): string {
  let s = raw.trim()
  // Order matters: preamble must come off first so the markdown fence regex
  // can match against the full remaining string. After fences come off, the
  // result might be quoted, so quote-stripping is last.
  s = stripCommonPreambles(s).trim()
  s = stripMarkdownFence(s).trim()
  s = stripSurroundingQuotes(s)
  return s.trim()
}

function stripMarkdownFence(s: string): string {
  const match = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/.exec(s)
  return match?.[1] ?? s
}

function stripCommonPreambles(s: string): string {
  const patterns = [
    /^(?:here'?s|here is)\s+(?:the\s+)?(?:rewritten|revised|updated|improved)\s+prompt[:\s]*\n+/i,
    /^rewritten prompt[:\s]*\n+/i,
    /^revised prompt[:\s]*\n+/i,
  ]
  for (const pattern of patterns) {
    s = s.replace(pattern, '')
  }
  return s
}

function stripSurroundingQuotes(s: string): string {
  if ((s.startsWith('"""') && s.endsWith('"""')) && s.length > 6) {
    return s.slice(3, -3)
  }
  if ((s.startsWith('"') && s.endsWith('"')) && s.length > 1) {
    return s.slice(1, -1)
  }
  return s
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
