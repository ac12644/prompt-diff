import { describe, it, expect } from 'vitest'
import { runTestSuite } from '../../src/core/runner/runner.js'
import { MockProvider } from '../../src/providers/mock.js'
import type { Config } from '../../src/types.js'

function suite(overrides: Partial<Config> = {}): Config {
  return {
    model: 'gpt-4o',
    judge_model: 'gpt-4o-mini',
    runs_per_test: 1,
    concurrency: 5,
    tests: [
      { id: 'a', input: 'hi',  assert: [{ type: 'contains', value: 'x' }] },
      { id: 'b', input: 'bye', assert: [{ type: 'contains', value: 'x' }] },
    ],
    ...overrides,
  }
}

describe('runTestSuite', () => {
  it('executes every test once and tags the version', async () => {
    const provider = new MockProvider('gpt-4o', (_p, input) => `echo ${input}`)
    const results = await runTestSuite(suite(), 'system prompt', 'v1', provider)
    expect(results).toHaveLength(2)
    expect(results.every(r => r.version === 'v1')).toBe(true)
    expect(results.map(r => r.testId)).toEqual(['a', 'b'])
    expect(results[0]?.output).toBe('echo hi')
  })

  it('interpolates {{var}} placeholders from test.vars', async () => {
    const provider = new MockProvider('gpt-4o', (_p, input) => `received: ${input}`)
    const cfg = suite({
      tests: [{
        id: 't', input: 'hello {{name}}', vars: { name: 'world' },
        assert: [{ type: 'contains', value: 'x' }],
      }],
    })
    const results = await runTestSuite(cfg, 'sys', 'v1', provider)
    expect(results[0]?.output).toBe('received: hello world')
  })

  it('passes through unknown {{var}} placeholders unchanged', async () => {
    const provider = new MockProvider('gpt-4o', (_p, input) => input)
    const cfg = suite({
      tests: [{ id: 't', input: 'a {{missing}} b', assert: [{ type: 'contains', value: 'x' }] }],
    })
    const results = await runTestSuite(cfg, 'sys', 'v1', provider)
    expect(results[0]?.output).toBe('a {{missing}} b')
  })

  it('averages tokens and cost across runs_per_test, keeps last output', async () => {
    let i = 0
    const provider = new MockProvider('gpt-4o', () => ({
      output: `run-${++i}`,
      inputTokens:  100,
      outputTokens: 50,
    }))
    const cfg = suite({
      runs_per_test: 3,
      tests: [{ id: 't', input: 'x', assert: [{ type: 'contains', value: 'x' }] }],
    })
    const results = await runTestSuite(cfg, 'sys', 'v1', provider)
    expect(results[0]?.output).toBe('run-3')
    expect(results[0]?.inputTokens).toBe(100)
    expect(results[0]?.outputTokens).toBe(50)
  })

  it('captures provider errors as RunResult.error rather than throwing', async () => {
    const provider = new MockProvider('gpt-4o', () => {
      throw new Error('rate limited')
    })
    const cfg = suite({
      tests: [{ id: 'fails', input: 'x', assert: [{ type: 'contains', value: 'x' }] }],
    })
    const results = await runTestSuite(cfg, 'sys', 'v1', provider)
    expect(results[0]?.error).toContain('rate limited')
    expect(results[0]?.output).toBe('')
  })

  it('respects the concurrency cap', async () => {
    const provider = new MockProvider('gpt-4o', () => 'ok', { delayMs: 30 })
    const tests = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, input: 'x', assert: [{ type: 'contains' as const, value: 'x' }],
    }))
    const cfg = suite({ concurrency: 3, tests })
    await runTestSuite(cfg, 'sys', 'v1', provider)
    expect(provider.stats().maxInFlight).toBeLessThanOrEqual(3)
    expect(provider.stats().callCount).toBe(10)
  })
})
