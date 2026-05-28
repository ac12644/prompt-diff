import { describe, it, expect } from 'vitest'
import { judgeResults, judgeAllResults } from '../../src/core/judge/judge.js'
import { MockProvider } from '../../src/providers/mock.js'
import type { Config, RunResult, TestCase } from '../../src/types.js'

function runResult(overrides: Partial<RunResult> & { testId: string; version: 'v1' | 'v2' }): RunResult {
  return {
    output: '',
    inputTokens: 10,
    outputTokens: 10,
    latencyMs: 1,
    costUsd: 0.0001,
    ...overrides,
  }
}

const noopJudge = new MockProvider('gpt-4o-mini', () => '{"winner":"tie","scoreA":80,"scoreB":80,"reason":"both ok"}')

describe('judgeResults', () => {
  it('verdict=pass when v2 holds all deterministic assertions', async () => {
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'contains', value: 'hi' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'hi there' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'hi friend' })
    const result = await judgeResults(v1, v2, test, noopJudge)
    expect(result.verdict).toBe('pass')
    expect(result.regressionScore).toBe(100)
  })

  it('verdict=fail when v2 breaks an assertion v1 passed', async () => {
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'contains', value: 'thanks' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'thanks!' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'whatever' })
    const result = await judgeResults(v1, v2, test, noopJudge)
    expect(result.verdict).toBe('fail')
    expect(result.regressionScore).toBe(0)
  })

  it('uses scoreB from llm_judge response', async () => {
    const judge = new MockProvider(
      'gpt-4o-mini',
      () => '{"winner":"B","scoreA":50,"scoreB":85,"reason":"v2 is clearer"}',
    )
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'llm_judge', criteria: 'is clear' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'verbose' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'concise' })
    const result = await judgeResults(v1, v2, test, judge)
    expect(result.regressionScore).toBe(85)
    expect(result.verdict).toBe('warn')
    expect(result.reason).toContain('v2 is clearer')
  })

  it('treats malformed judge JSON as failure with a reason', async () => {
    const judge = new MockProvider('gpt-4o-mini', () => 'sorry, here is some prose not JSON')
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'llm_judge', criteria: 'is clear' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'a' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'b' })
    const result = await judgeResults(v1, v2, test, judge)
    expect(result.verdict).toBe('fail')
    expect(result.regressionScore).toBe(0)
    expect(result.reason).toContain('not valid JSON')
  })

  it('accepts judge response wrapped in markdown fence', async () => {
    const judge = new MockProvider(
      'gpt-4o-mini',
      () => '```json\n{"winner":"A","scoreA":90,"scoreB":80,"reason":"meh"}\n```',
    )
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'llm_judge', criteria: 'is good' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'a' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'b' })
    const result = await judgeResults(v1, v2, test, judge)
    expect(result.regressionScore).toBe(80)
  })

  it('verdict=fail when v2 has a run error, regardless of score', async () => {
    const test: TestCase = {
      id: 't', input: 'x',
      assert: [{ type: 'contains', value: 'hi' }],
    }
    const v1 = runResult({ testId: 't', version: 'v1', output: 'hi' })
    const v2 = runResult({ testId: 't', version: 'v2', output: 'hi', error: 'timeout' })
    const result = await judgeResults(v1, v2, test, noopJudge)
    expect(result.verdict).toBe('fail')
  })
})

describe('judgeAllResults', () => {
  it('pairs results by testId and judges every pair', async () => {
    const config: Config = {
      model: 'gpt-4o', judge_model: 'gpt-4o-mini',
      runs_per_test: 1, concurrency: 5,
      tests: [
        { id: 'a', input: 'x', assert: [{ type: 'contains', value: 'hi' }] },
        { id: 'b', input: 'x', assert: [{ type: 'contains', value: 'bye' }] },
      ],
    }
    const v1Results = [
      runResult({ testId: 'a', version: 'v1', output: 'hi' }),
      runResult({ testId: 'b', version: 'v1', output: 'bye' }),
    ]
    const v2Results = [
      runResult({ testId: 'a', version: 'v2', output: 'hi' }),
      runResult({ testId: 'b', version: 'v2', output: 'bye' }),
    ]
    const results = await judgeAllResults(v1Results, v2Results, config, noopJudge)
    expect(results.map(r => r.testId).sort()).toEqual(['a', 'b'])
    expect(results.every(r => r.verdict === 'pass')).toBe(true)
  })

  it('skips tests with missing v1 or v2 result', async () => {
    const config: Config = {
      model: 'gpt-4o', judge_model: 'gpt-4o-mini',
      runs_per_test: 1, concurrency: 5,
      tests: [
        { id: 'a', input: 'x', assert: [{ type: 'contains', value: 'hi' }] },
        { id: 'orphan', input: 'x', assert: [{ type: 'contains', value: 'x' }] },
      ],
    }
    const v1Results = [runResult({ testId: 'a', version: 'v1', output: 'hi' })]
    const v2Results = [runResult({ testId: 'a', version: 'v2', output: 'hi' })]
    const results = await judgeAllResults(v1Results, v2Results, config, noopJudge)
    expect(results).toHaveLength(1)
    expect(results[0]?.testId).toBe('a')
  })
})
