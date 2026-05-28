import chalk from 'chalk'
import type { SuggestionReport, WeaknessSummary } from '../types.js'

const RULE = '─'.repeat(60)

/** Render a SuggestionReport to a terminal block (chalk-colored). */
export function renderSuggestTerminal(report: SuggestionReport, promptPath: string): string {
  const lines: string[] = []
  lines.push(chalk.bold(`promptdiff suggest: ${promptPath}`))
  lines.push(RULE)
  lines.push(`  Rewriter:          ${report.suggesterModel}`)
  lines.push(`  Verdict:           ${verdictBadge(report)}`)
  lines.push(`  Score vs baseline: ${report.diff.regressionScore} / 100`)
  lines.push(`  Cost (avg/call):   ${formatCost(report)}`)
  lines.push('')
  lines.push(renderWeaknesses(report.weaknesses))
  lines.push('')
  lines.push(renderPerTest(report))
  lines.push(RULE)
  lines.push('')
  lines.push(chalk.bold('SUGGESTED PROMPT:'))
  lines.push('')
  lines.push(report.suggestedPrompt)
  return lines.join('\n')
}

/** JSON variant — drops chalk, preserves the full SuggestionReport shape. */
export function renderSuggestJson(report: SuggestionReport, promptPath: string): string {
  return JSON.stringify({ promptPath, ...report }, null, 2)
}

function verdictBadge(report: SuggestionReport): string {
  if (report.accepted) return chalk.green.bold('ACCEPT — suggestion improves baseline')
  if (report.diff.verdict === 'warn') return chalk.yellow.bold('REVIEW — partial improvement')
  return chalk.red.bold('REJECT — suggestion regresses baseline')
}

function formatCost(report: SuggestionReport): string {
  const { v1AvgCostUsd, v2AvgCostUsd, deltaPercent } = report.diff.costDelta
  const arrow = `$${v1AvgCostUsd.toFixed(5)} → $${v2AvgCostUsd.toFixed(5)}`
  const pct = `${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%`
  const colored = deltaPercent <= 0 ? chalk.green(pct) : chalk.red(pct)
  return `${arrow}  (${colored})`
}

function renderWeaknesses(weaknesses: WeaknessSummary[]): string {
  if (weaknesses.length === 0) {
    return `  ${chalk.green('Baseline has no deterministic failures.')}`
  }
  const lines: string[] = [`  ${chalk.bold('Baseline weaknesses targeted by the rewriter:')}`]
  for (const w of weaknesses) {
    lines.push(`    ${chalk.red('✗')} ${w.testId}`)
    for (const f of w.failedAssertions) lines.push(`        ${f}`)
  }
  return lines.join('\n')
}

function renderPerTest(report: SuggestionReport): string {
  const lines: string[] = [`  ${chalk.bold('Per-test outcome (suggestion vs baseline):')}`]
  for (const r of report.diff.results) {
    const sym = r.verdict === 'pass' ? chalk.green('✓')
              : r.verdict === 'warn' ? chalk.yellow('⚠')
              :                         chalk.red('✗')
    lines.push(`    ${sym} ${padEnd(r.testId, 32)} ${padStart(String(r.regressionScore), 3)}`)
  }
  return lines.join('\n')
}

function padEnd(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length)
}
function padStart(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s
}
