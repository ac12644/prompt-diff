import type { CostDelta, DiffReport, JudgeResult, RunResult, TextDiff, Verdict } from '../../types.js'

const PASS_THRESHOLD = 90
const WARN_THRESHOLD = 70

/** Aggregate per-pair JudgeResults plus run metadata into a top-level DiffReport. */
export function computeReport(
  judgeResults: JudgeResult[],
  textDiff: TextDiff,
  v1Results: RunResult[],
  v2Results: RunResult[],
): DiffReport {
  const totalTests = judgeResults.length
  const passed = countByVerdict(judgeResults, 'pass')
  const warned = countByVerdict(judgeResults, 'warn')
  const failed = countByVerdict(judgeResults, 'fail')

  const regressionScore = aggregateRegressionScore(judgeResults)
  const verdict = aggregateVerdict(regressionScore, failed, totalTests)
  const costDelta = computeCostDelta(v1Results, v2Results)

  return {
    textDiff,
    costDelta,
    regressionScore,
    verdict,
    totalTests,
    passed,
    warned,
    failed,
    results: judgeResults,
  }
}

function countByVerdict(results: JudgeResult[], verdict: Verdict): number {
  return results.filter(r => r.verdict === verdict).length
}

function aggregateRegressionScore(results: JudgeResult[]): number {
  if (results.length === 0) return 100
  const total = results.reduce((sum, r) => sum + r.regressionScore, 0)
  return Math.round(total / results.length)
}

function verdictFromScore(score: number): Verdict {
  if (score >= PASS_THRESHOLD) return 'pass'
  if (score >= WARN_THRESHOLD) return 'warn'
  return 'fail'
}

/**
 * Top-level verdict combines the score-based verdict with the failure count.
 * A test can have a perfect score yet still be marked fail (e.g. v2 errored),
 * so the score alone undercounts disasters. We take the worse of the two.
 */
function aggregateVerdict(score: number, failed: number, totalTests: number): Verdict {
  if (totalTests === 0) return verdictFromScore(score)
  const fromScore = verdictFromScore(score)
  const fromFailures: Verdict =
    failed === 0           ? 'pass'
  : failed * 2 > totalTests ? 'fail'   // majority failed
  :                          'warn'
  return worse(fromScore, fromFailures)
}

function worse(a: Verdict, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { pass: 0, warn: 1, fail: 2 }
  return rank[a] >= rank[b] ? a : b
}

function computeCostDelta(v1: RunResult[], v2: RunResult[]): CostDelta {
  const v1AvgCostUsd = average(v1.map(r => r.costUsd))
  const v2AvgCostUsd = average(v2.map(r => r.costUsd))
  const deltaUsd = v2AvgCostUsd - v1AvgCostUsd
  const deltaPercent = v1AvgCostUsd === 0 ? 0 : (deltaUsd / v1AvgCostUsd) * 100
  return { v1AvgCostUsd, v2AvgCostUsd, deltaUsd, deltaPercent }
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((sum, n) => sum + n, 0) / nums.length
}
