import { describe, it, expect, beforeAll } from 'vitest'
import chalk from 'chalk'
import { renderTerminal } from '../../src/reporters/terminal.js'
import { JsonReporter } from '../../src/reporters/json.js'
import { createReporter } from '../../src/reporters/index.js'
import { TerminalReporter } from '../../src/reporters/terminal.js'
import type { DiffReport } from '../../src/types.js'

beforeAll(() => {
  chalk.level = 0 // disable ANSI in snapshots
})

const sampleReport: DiffReport = {
  textDiff: { added: 2, removed: 1, tokenDelta: 15, tokenDeltaPercent: 3.6 },
  costDelta: { v1AvgCostUsd: 0.001, v2AvgCostUsd: 0.0008, deltaUsd: -0.0002, deltaPercent: -20 },
  regressionScore: 92,
  verdict: 'pass',
  totalTests: 3,
  passed: 2,
  warned: 1,
  failed: 0,
  results: [
    { testId: 'a', verdict: 'pass', regressionScore: 100, assertionResults: [] },
    {
      testId: 'b', verdict: 'warn', regressionScore: 75,
      assertionResults: [
        { assertion: { type: 'contains', value: 'thanks' }, passed: false, version: 'v2' },
      ],
    },
    { testId: 'c', verdict: 'pass', regressionScore: 100, assertionResults: [] },
  ],
}

describe('renderTerminal', () => {
  it('includes the verdict, score, and counts', () => {
    const out = renderTerminal(sampleReport, 'v1.txt', 'v2.txt')
    expect(out).toContain('PASS')
    expect(out).toContain('92 / 100')
    expect(out).toContain('2 passed')
    expect(out).toContain('1 warn')
    expect(out).toContain('0 failed')
    expect(out).toContain('(3 total)')
  })

  it('shows the file paths in the header', () => {
    const out = renderTerminal(sampleReport, 'prompts/old.txt', 'prompts/new.txt')
    expect(out).toContain('prompts/old.txt → prompts/new.txt')
  })

  it('lists each test result with a status row', () => {
    const out = renderTerminal(sampleReport, 'v1', 'v2')
    expect(out).toContain('a')
    expect(out).toContain('b')
    expect(out).toContain('c')
  })

  it('surfaces failed assertion descriptions inline', () => {
    const out = renderTerminal(sampleReport, 'v1', 'v2')
    expect(out).toContain('contains')
    expect(out).toContain('thanks')
  })

  it('formats cost delta with sign and percent', () => {
    const out = renderTerminal(sampleReport, 'v1', 'v2')
    expect(out).toContain('$0.00100 → $0.00080')
    expect(out).toContain('-20.0%')
  })
})

describe('JsonReporter', () => {
  it('writes a JSON payload that round-trips through DiffReport shape', () => {
    let captured = ''
    const stream = { write: (chunk: string) => { captured += chunk; return true } } as NodeJS.WriteStream
    const reporter = new JsonReporter(stream)
    reporter.render(sampleReport, 'a.txt', 'b.txt')
    const parsed = JSON.parse(captured)
    expect(parsed.verdict).toBe('pass')
    expect(parsed.regressionScore).toBe(92)
    expect(parsed.v1Path).toBe('a.txt')
    expect(parsed.results).toHaveLength(3)
  })
})

describe('createReporter', () => {
  it('returns a TerminalReporter by default', () => {
    expect(createReporter('terminal')).toBeInstanceOf(TerminalReporter)
  })
  it('returns a JsonReporter for json format', () => {
    expect(createReporter('json')).toBeInstanceOf(JsonReporter)
  })
})
