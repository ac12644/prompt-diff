import chalk from 'chalk'
import type { AssertionResult, DiffReport, JudgeResult, Reporter, Verdict } from '../types.js'

/** Renders a DiffReport to a chalk-colored 80-col terminal block. */
export class TerminalReporter implements Reporter {
  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  render(report: DiffReport, v1Path: string, v2Path: string): void {
    this.stream.write(renderTerminal(report, v1Path, v2Path) + '\n')
  }
}

const RULE = '─'.repeat(60)

/** Pure renderer — emits the terminal block as a single string for testability. */
export function renderTerminal(report: DiffReport, v1Path: string, v2Path: string): string {
  const lines: string[] = []
  lines.push(chalk.bold(`promptdiff: ${v1Path} → ${v2Path}`))
  lines.push(RULE)
  lines.push(`  Verdict:           ${colorVerdict(report.verdict)}`)
  lines.push(`  Regression Score:  ${report.regressionScore} / 100`)
  lines.push(`  Tests:             ${summarizeCounts(report)}`)
  lines.push('')
  lines.push(`  Cost (avg/call):   ${formatCostDelta(report)}`)
  lines.push(`  Text diff:         ${formatTextDiff(report)}`)
  lines.push(RULE)
  lines.push('')
  for (const r of report.results) lines.push(renderTestRow(r))
  return lines.join('\n')
}

function colorVerdict(verdict: Verdict): string {
  if (verdict === 'pass') return chalk.green.bold('PASS')
  if (verdict === 'warn') return chalk.yellow.bold('WARN')
  return chalk.red.bold('FAIL')
}

function summarizeCounts(r: DiffReport): string {
  const counts = [
    chalk.green(`${r.passed} passed`),
    chalk.yellow(`${r.warned} warn`),
    chalk.red(`${r.failed} failed`),
  ].join(', ')
  return `${counts} (${r.totalTests} total)`
}

function formatCostDelta(r: DiffReport): string {
  const { v1AvgCostUsd, v2AvgCostUsd, deltaPercent } = r.costDelta
  const arrow = `$${v1AvgCostUsd.toFixed(5)} → $${v2AvgCostUsd.toFixed(5)}`
  const pct = `${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%`
  const colored = deltaPercent <= 0 ? chalk.green(pct) : chalk.red(pct)
  return `${arrow}  (${colored})`
}

function formatTextDiff(r: DiffReport): string {
  const td = r.textDiff
  const lineChange = `${chalk.green(`+${td.added}`)} / ${chalk.red(`-${td.removed}`)} lines`
  const pct = `${td.tokenDeltaPercent >= 0 ? '+' : ''}${td.tokenDeltaPercent.toFixed(1)}%`
  return `${lineChange}, tokens Δ ${td.tokenDelta} (${pct})`
}

function renderTestRow(result: JudgeResult): string {
  const symbol = symbolForVerdict(result.verdict)
  // Padding accommodates the longest realistic test id (~30 chars). Longer ids
  // overflow the column gracefully rather than misaligning the score.
  const id = padEnd(result.testId, 32)
  const score = padStart(String(result.regressionScore), 3)
  const summary = summarizeFailures(result)
  const head = `  ${symbol} ${id} ${score}`
  return summary ? `${head}\n${summary}` : head
}

function symbolForVerdict(verdict: Verdict): string {
  if (verdict === 'pass') return chalk.green('✓')
  if (verdict === 'warn') return chalk.yellow('⚠')
  return chalk.red('✗')
}

function summarizeFailures(result: JudgeResult): string {
  // Only surface v2 regressions on non-passing tests. v1 failures that v2 fixed
  // are improvements, not problems — listing them under a green ✓ confuses readers.
  if (result.verdict === 'pass') return ''
  const regressions = result.assertionResults.filter(r => !r.passed && r.version !== 'v1')
  if (regressions.length === 0) return ''
  return regressions.map(r => `      ${chalk.red('✗')} ${describeAssertion(r)}`).join('\n')
}

function describeAssertion(r: AssertionResult): string {
  const a = r.assertion
  const detail = r.detail ? `  [${r.detail}]` : ''
  if (a.type === 'llm_judge') return `llm_judge "${truncate(a.criteria, 40)}"  ${r.version}${detail}`
  if (a.type === 'length_under') return `length_under ${a.value}  ${r.version}${detail}`
  return `${a.type} "${truncate(String(a.value), 40)}"  ${r.version}${detail}`
}

function padEnd(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function padStart(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
