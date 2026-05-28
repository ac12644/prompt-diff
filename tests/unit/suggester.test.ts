import { describe, it, expect } from 'vitest'
import {
  analyzeWeaknesses,
  buildRewriteRequest,
  extractRewrittenPrompt,
} from '../../src/core/suggester/suggester.js'
import type { RunResult, TestCase } from '../../src/types.js'

function result(testId: string, output: string): RunResult {
  return {
    testId, version: 'v1', output,
    inputTokens: 10, outputTokens: 10, latencyMs: 1, costUsd: 0.0001,
  }
}

const tests: TestCase[] = [
  {
    id: 'greeting',
    input: 'Say hi politely.',
    assert: [{ type: 'contains', value: 'hello' }, { type: 'length_under', value: 100 }],
  },
  {
    id: 'no_apology',
    input: 'Respond to an angry customer.',
    assert: [{ type: 'not_contains', value: 'unfortunately' }],
  },
  {
    id: 'judged_only',
    input: 'Explain rain.',
    assert: [{ type: 'llm_judge', criteria: 'is factually correct' }],
  },
]

describe('analyzeWeaknesses', () => {
  it('returns summaries only for tests with deterministic failures', () => {
    const baseline = [
      result('greeting',     'hi there'),         // missing "hello"
      result('no_apology',   'I am calm.'),       // passes
      result('judged_only',  'rain falls'),       // llm_judge ignored
    ]
    const summaries = analyzeWeaknesses(tests, baseline)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.testId).toBe('greeting')
    expect(summaries[0]?.failedAssertions).toContain('must contain "hello"')
  })

  it('captures multiple failures within one test', () => {
    const baseline = [result('greeting', 'a'.repeat(200))]  // missing "hello" AND too long
    const summaries = analyzeWeaknesses([tests[0]!], baseline)
    expect(summaries[0]?.failedAssertions).toHaveLength(2)
  })

  it('skips llm_judge assertions entirely', () => {
    const baseline = [result('judged_only', '')]
    const summaries = analyzeWeaknesses([tests[2]!], baseline)
    expect(summaries).toHaveLength(0)
  })

  it('handles missing run results gracefully', () => {
    const summaries = analyzeWeaknesses(tests, [])
    expect(summaries).toEqual([])
  })

  it('describes each assertion type in plain English', () => {
    const baseline = [
      result('greeting',   ''),                  // contains fails
      result('no_apology', 'unfortunately yes'), // not_contains fails
    ]
    const summaries = analyzeWeaknesses(tests, baseline)
    const greetingFailures = summaries.find(s => s.testId === 'greeting')?.failedAssertions
    const apologyFailures = summaries.find(s => s.testId === 'no_apology')?.failedAssertions
    expect(greetingFailures?.[0]).toBe('must contain "hello"')
    expect(apologyFailures?.[0]).toBe('must NOT contain "unfortunately"')
  })
})

describe('buildRewriteRequest', () => {
  it('produces a user-input string with the original prompt, cases, and failure list', () => {
    const baseline = [result('greeting', 'hi'), result('no_apology', 'unfortunately')]
    const weaknesses = analyzeWeaknesses(tests, baseline)
    const request = buildRewriteRequest('You are concise.', tests, baseline, weaknesses)

    expect(request.systemPrompt).toContain('senior prompt engineer')
    expect(request.userInput).toContain('You are concise.')
    expect(request.userInput).toContain('Case 1: greeting')
    expect(request.userInput).toContain('must contain "hello"')
    expect(request.userInput).toContain('must NOT contain "unfortunately"')
  })

  it('marks fully-passing cases as preserve-this', () => {
    const baseline = [result('greeting', 'hello there, friend')]
    const request = buildRewriteRequest('p', [tests[0]!], baseline, [])
    expect(request.userInput).toContain('All deterministic checks PASSED')
  })

  it('truncates very long inputs and outputs to keep the prompt manageable', () => {
    const longInput  = 'x'.repeat(2000)
    const longOutput = 'y'.repeat(2000)
    const testWithLongInput: TestCase = {
      id: 'big', input: longInput,
      assert: [{ type: 'contains', value: 'something' }],
    }
    const baseline = [result('big', longOutput)]
    const request = buildRewriteRequest('p', [testWithLongInput], baseline, [])
    expect(request.userInput.length).toBeLessThan(2500)
  })
})

describe('extractRewrittenPrompt', () => {
  it('returns the input unchanged when no wrapping is present', () => {
    const raw = 'You are a calm support agent.\nKeep replies under 80 words.'
    expect(extractRewrittenPrompt(raw)).toBe(raw)
  })

  it('strips a fenced markdown block', () => {
    const raw = '```\nYou are a calm agent.\n```'
    expect(extractRewrittenPrompt(raw)).toBe('You are a calm agent.')
  })

  it('strips a language-tagged fence', () => {
    const raw = '```markdown\nYou are X.\nLine two.\n```'
    expect(extractRewrittenPrompt(raw)).toBe('You are X.\nLine two.')
  })

  it('strips common preambles', () => {
    expect(extractRewrittenPrompt("Here's the rewritten prompt:\n\nYou are X."))
      .toBe('You are X.')
    expect(extractRewrittenPrompt('Rewritten prompt:\nYou are Y.'))
      .toBe('You are Y.')
  })

  it('strips matched surrounding triple-quotes', () => {
    expect(extractRewrittenPrompt('"""You are Z."""')).toBe('You are Z.')
  })

  it('strips matched surrounding double-quotes', () => {
    expect(extractRewrittenPrompt('"You are W."')).toBe('You are W.')
  })

  it('leaves unmatched quotes alone', () => {
    expect(extractRewrittenPrompt('"You said "hi" earlier."'))
      .toBe('You said "hi" earlier.')
  })
})
