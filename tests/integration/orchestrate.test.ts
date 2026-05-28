import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { orchestrate } from '../../src/orchestrate.js'
import { MockProvider } from '../../src/providers/mock.js'
import type { Provider, ProviderKeys } from '../../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = (...parts: string[]): string => resolve(here, '..', 'fixtures', ...parts)

function mockFactory(map: Map<string, string>): (model: string, _: ProviderKeys) => Provider {
  return (model) => new MockProvider(model, (prompt, input) => {
    const key = `${model}|${prompt.split('\n')[0]}|${input}`
    return map.get(key) ?? map.get(`${model}|*|${input}`) ?? `auto: ${input}`
  })
}

describe('orchestrate (integration, mock providers, no network)', () => {
  let cacheDir: string

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'promptdiff-int-'))
  })
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('runs the full pipeline and produces a DiffReport with v2 winning', async () => {
    const responses = new Map<string, string>([
      // v1 outputs (terser prompt)
      ['gpt-4o|You are a concise assistant. Reply briefly.|Say hello',                'hi'],
      ['gpt-4o|You are a concise assistant. Reply briefly.|Reply to: I waited 2 weeks!', 'unfortunately we are slow'],
      ['gpt-4o|You are a concise assistant. Reply briefly.|Explain rain',              'water falls'],

      // v2 outputs (friendlier prompt)
      ['gpt-4o|You are a friendly assistant.|Say hello',                'hello friend!'],
      ['gpt-4o|You are a friendly assistant.|Reply to: I waited 2 weeks!', 'thank you for your patience'],
      ['gpt-4o|You are a friendly assistant.|Explain rain',              'rain is condensed water vapor'],

      // judge says v2 is better
      ['gpt-4o-mini|*|*', '{"winner":"B","scoreA":60,"scoreB":92,"reason":"v2 is clearer"}'],
    ])
    // Add judge entries for each test (input varies, so use a permissive fallback)
    const judgeFactory = (model: string): Provider => {
      if (model === 'gpt-4o-mini') {
        return new MockProvider(model, () => '{"winner":"B","scoreA":60,"scoreB":92,"reason":"v2 is clearer"}')
      }
      return mockFactory(responses)(model, {})
    }

    const report = await orchestrate(
      fixturePath('prompts', 'v1.txt'),
      fixturePath('prompts', 'v2.txt'),
      fixturePath('suites', 'integration.yaml'),
      {
        format: 'json',
        cacheDir,
        providerFactory: judgeFactory,
      },
    )

    expect(report.totalTests).toBe(3)
    expect(report.results.map(r => r.testId).sort()).toEqual(['greeting', 'judged', 'thanks'])
    expect(report.passed + report.warned + report.failed).toBe(3)
    expect(report.textDiff.added).toBeGreaterThan(0)
    expect(report.costDelta.v1AvgCostUsd).toBeGreaterThan(0)
    expect(report.costDelta.v2AvgCostUsd).toBeGreaterThan(0)

    const greeting = report.results.find(r => r.testId === 'greeting')
    expect(greeting?.verdict).toBe('pass')

    const thanks = report.results.find(r => r.testId === 'thanks')
    // v1 said "unfortunately", v2 said "thank you" — v2 fixes a regression
    expect(thanks?.verdict).toBe('pass')

    const judged = report.results.find(r => r.testId === 'judged')
    expect(judged?.regressionScore).toBe(92)
  })

  it('produces deterministic results when invoked twice with cache enabled', async () => {
    const responder = (() => {
      let counter = 0
      return (_p: string, input: string) => `${input}-${++counter}`
    })()
    const factory = (model: string) => new MockProvider(model, responder)
    const judgeFactory = (model: string): Provider => {
      if (model === 'gpt-4o-mini') {
        return new MockProvider(model, () => '{"winner":"tie","scoreA":80,"scoreB":80,"reason":"tied"}')
      }
      return factory(model)
    }

    const first = await orchestrate(
      fixturePath('prompts', 'v1.txt'),
      fixturePath('prompts', 'v2.txt'),
      fixturePath('suites', 'integration.yaml'),
      { format: 'json', cacheDir, providerFactory: judgeFactory },
    )
    const second = await orchestrate(
      fixturePath('prompts', 'v1.txt'),
      fixturePath('prompts', 'v2.txt'),
      fixturePath('suites', 'integration.yaml'),
      { format: 'json', cacheDir, providerFactory: judgeFactory },
    )

    expect(second.results.map(r => r.regressionScore)).toEqual(first.results.map(r => r.regressionScore))
  })

  it('skips cache and re-calls provider when noCache is set', async () => {
    let calls = 0
    const factory = (model: string): Provider => new MockProvider(model, () => {
      calls++
      if (model === 'gpt-4o-mini') return '{"winner":"tie","scoreA":80,"scoreB":80,"reason":"tied"}'
      return 'output'
    })

    await orchestrate(
      fixturePath('prompts', 'v1.txt'),
      fixturePath('prompts', 'v2.txt'),
      fixturePath('suites', 'integration.yaml'),
      { format: 'json', cacheDir, noCache: true, providerFactory: factory },
    )
    const callsAfterFirst = calls

    await orchestrate(
      fixturePath('prompts', 'v1.txt'),
      fixturePath('prompts', 'v2.txt'),
      fixturePath('suites', 'integration.yaml'),
      { format: 'json', cacheDir, noCache: true, providerFactory: factory },
    )
    expect(calls).toBeGreaterThan(callsAfterFirst)
  })
})
