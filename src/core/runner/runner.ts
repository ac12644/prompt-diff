import type { Config, Provider, RunResult, TestCase, Version } from '../../types.js'
import { withConcurrencyLimit } from './concurrency.js'

/** Run every test case in `config` against `prompt` using `provider`. */
export async function runTestSuite(
  config: Config,
  prompt: string,
  version: Version,
  provider: Provider,
): Promise<RunResult[]> {
  const tasks = config.tests.map(
    test => () => runOneTest(test, prompt, version, provider, config.runs_per_test),
  )
  return withConcurrencyLimit(tasks, config.concurrency)
}

async function runOneTest(
  test: TestCase,
  prompt: string,
  version: Version,
  provider: Provider,
  runsPerTest: number,
): Promise<RunResult> {
  const input = interpolateVars(test.input, test.vars ?? {})
  const { runs, error } = await collectRuns(provider, prompt, input, runsPerTest)
  if (runs.length === 0) return errorResult(test.id, version, error ?? 'no runs completed')
  return averageRuns(runs, test.id, version)
}

async function collectRuns(
  provider: Provider,
  prompt: string,
  input: string,
  runsPerTest: number,
): Promise<{ runs: RunResult[]; error?: string }> {
  const runs: RunResult[] = []
  let lastError: string | undefined
  for (let i = 0; i < runsPerTest; i++) {
    try {
      runs.push(await provider.complete(prompt, input))
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  return lastError !== undefined ? { runs, error: lastError } : { runs }
}

function averageRuns(runs: RunResult[], testId: string, version: Version): RunResult {
  const n = runs.length
  const last = runs[n - 1]
  if (!last) throw new Error('averageRuns called with empty runs (unreachable)')
  return {
    testId,
    version,
    output:       last.output,
    inputTokens:  sum(runs, r => r.inputTokens)  / n,
    outputTokens: sum(runs, r => r.outputTokens) / n,
    latencyMs:    sum(runs, r => r.latencyMs)    / n,
    costUsd:      sum(runs, r => r.costUsd)      / n,
  }
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((s, item) => s + pick(item), 0)
}

function errorResult(testId: string, version: Version, message: string): RunResult {
  return {
    testId,
    version,
    output: '',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    error: message,
  }
}

function interpolateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}
