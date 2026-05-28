import { describe, it, expect } from 'vitest'
import { computeReport } from '../../src/core/scorer/scorer.js'
import type { JudgeResult, RunResult, TextDiff } from '../../src/types.js'

const noTextDiff: TextDiff = { added: 0, removed: 0, tokenDelta: 0, tokenDeltaPercent: 0 }

function pair(id: string, costV1: number, costV2: number): { v1: RunResult; v2: RunResult } {
  const base = { inputTokens: 10, outputTokens: 10, latencyMs: 1, output: '' }
  return {
    v1: { testId: id, version: 'v1', costUsd: costV1, ...base },
    v2: { testId: id, version: 'v2', costUsd: costV2, ...base },
  }
}

function judge(id: string, score: number, verdict: JudgeResult['verdict']): JudgeResult {
  return { testId: id, verdict, regressionScore: score, assertionResults: [] }
}

describe('computeReport', () => {
  it('reports pass and aggregate score 100 when every pair passes', () => {
    const pairs = [pair('a', 0.01, 0.01), pair('b', 0.02, 0.02)]
    const judged = [judge('a', 100, 'pass'), judge('b', 100, 'pass')]
    const report = computeReport(judged, noTextDiff, pairs.map(p => p.v1), pairs.map(p => p.v2))
    expect(report.regressionScore).toBe(100)
    expect(report.verdict).toBe('pass')
    expect(report.passed).toBe(2)
    expect(report.warned).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.totalTests).toBe(2)
  })

  it('reports fail when aggregate score drops below the warn threshold', () => {
    const pairs = [pair('a', 0.01, 0.05), pair('b', 0.01, 0.05)]
    const judged = [judge('a', 0, 'fail'), judge('b', 100, 'pass')]
    const report = computeReport(judged, noTextDiff, pairs.map(p => p.v1), pairs.map(p => p.v2))
    expect(report.regressionScore).toBe(50)
    expect(report.verdict).toBe('fail')
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(1)
  })

  it('reports warn for mid-range scores', () => {
    const pairs = [pair('a', 0.01, 0.01)]
    const judged = [judge('a', 80, 'warn')]
    const report = computeReport(judged, noTextDiff, pairs.map(p => p.v1), pairs.map(p => p.v2))
    expect(report.regressionScore).toBe(80)
    expect(report.verdict).toBe('warn')
  })

  it('computes cost delta and percent from run averages', () => {
    const v1 = [
      { testId: 'a', version: 'v1' as const, output: '', inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0.01 },
      { testId: 'b', version: 'v1' as const, output: '', inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0.03 },
    ]
    const v2 = [
      { testId: 'a', version: 'v2' as const, output: '', inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0.04 },
      { testId: 'b', version: 'v2' as const, output: '', inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0.04 },
    ]
    const report = computeReport([], noTextDiff, v1, v2)
    expect(report.costDelta.v1AvgCostUsd).toBeCloseTo(0.02, 6)
    expect(report.costDelta.v2AvgCostUsd).toBeCloseTo(0.04, 6)
    expect(report.costDelta.deltaUsd).toBeCloseTo(0.02, 6)
    expect(report.costDelta.deltaPercent).toBeCloseTo(100, 4)
  })

  it('marks aggregate fail when every test errored even if regression score is perfect', () => {
    // A run error sets verdict='fail' on the JudgeResult, but its regressionScore can
    // still be 100 (because deterministicScore treats both-empty outputs as no regression).
    // The aggregate must surface this disaster, not report PASS.
    const pairs = [pair('a', 0, 0), pair('b', 0, 0)]
    const judged = [judge('a', 100, 'fail'), judge('b', 100, 'fail')]
    const report = computeReport(judged, noTextDiff, pairs.map(p => p.v1), pairs.map(p => p.v2))
    expect(report.regressionScore).toBe(100)
    expect(report.failed).toBe(2)
    expect(report.verdict).toBe('fail')
  })

  it('downgrades a high-score result to warn when one test failed', () => {
    const pairs = [pair('a', 0, 0), pair('b', 0, 0), pair('c', 0, 0)]
    const judged = [
      judge('a', 100, 'pass'),
      judge('b', 100, 'pass'),
      judge('c', 100, 'fail'),   // one failure — majority still pass
    ]
    const report = computeReport(judged, noTextDiff, pairs.map(p => p.v1), pairs.map(p => p.v2))
    expect(report.regressionScore).toBe(100)
    expect(report.verdict).toBe('warn')
  })

  it('does not divide by zero on empty inputs', () => {
    const report = computeReport([], noTextDiff, [], [])
    expect(report.regressionScore).toBe(100)
    expect(report.verdict).toBe('pass')
    expect(report.totalTests).toBe(0)
    expect(report.costDelta.deltaPercent).toBe(0)
  })
})
