import type { Assertion, AssertionResult, Version } from '../../types.js'

/** Synchronously evaluate one assertion against one output. */
export function evaluate(assertion: Assertion, output: string): AssertionResult {
  switch (assertion.type) {
    case 'contains':
      return result(assertion, output.includes(assertion.value))
    case 'not_contains':
      return result(assertion, !output.includes(assertion.value))
    case 'length_under':
      return result(assertion, output.length < assertion.value)
    case 'starts_with':
      return result(assertion, output.trimStart().startsWith(assertion.value))
    case 'regex':
      return result(assertion, safeRegexTest(assertion.value, output))
    case 'llm_judge':
      // Async, judge-provider-backed assertions are routed through judge.ts.
      throw new Error('llm_judge assertions must be evaluated via the judge module, not evaluate()')
  }
}

/** Convenience overload for per-version output evaluation. */
export function evaluateForVersion(
  assertion: Assertion,
  output: string,
  version: Version,
): AssertionResult {
  const base = evaluate(assertion, output)
  return { ...base, version }
}

function result(assertion: Assertion, passed: boolean): AssertionResult {
  return { assertion, passed, version: 'both' }
}

function safeRegexTest(pattern: string, output: string): boolean {
  try {
    return new RegExp(pattern).test(output)
  } catch {
    return false
  }
}
