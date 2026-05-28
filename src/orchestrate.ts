import { computeTextDiff } from './core/differ/differ.js'
import { runTestSuite } from './core/runner/runner.js'
import { judgeAllResults } from './core/judge/judge.js'
import { computeReport } from './core/scorer/scorer.js'
import { loadConfig, readPromptFile } from './config/loader.js'
import { createProvider as defaultCreateProvider } from './providers/index.js'
import { CachedProvider } from './infra/cache.js'
import { createReporter } from './reporters/index.js'
import type { DiffReport, OrchestrateOptions, Provider, ProviderKeys } from './types.js'

/** Factory shape that orchestrate uses to build Providers. Override for tests. */
export type ProviderFactory = (model: string, keys: ProviderKeys) => Provider

/** Public orchestrate options plus an internal factory hook for testing. */
export type OrchestrateInternals = OrchestrateOptions & {
  providerFactory?: ProviderFactory
}

/** Top-level pipeline. Touches IO only through injected/factory-built modules. */
export async function orchestrate(
  v1Path: string,
  v2Path: string,
  suitePath: string,
  options: OrchestrateInternals = {},
): Promise<DiffReport> {
  const config = await loadConfig(suitePath)
  const v1Prompt = await readPromptFile(v1Path)
  const v2Prompt = await readPromptFile(v2Path)

  const model = options.model ?? config.model
  const keys = options.apiKeys ?? {}
  const factory = options.providerFactory ?? defaultCreateProvider

  const textDiff = computeTextDiff(v1Prompt, v2Prompt, model)
  const runProvider = wrapCache(factory(model, keys), options)

  const [v1Results, v2Results] = await Promise.all([
    runTestSuite(config, v1Prompt, 'v1', runProvider),
    runTestSuite(config, v2Prompt, 'v2', runProvider),
  ])

  const judgeResults = await judgeAllResults(v1Results, v2Results, config, factory(config.judge_model, keys))
  const report = computeReport(judgeResults, textDiff, v1Results, v2Results)
  createReporter(options.format ?? 'terminal').render(report, v1Path, v2Path)
  return report
}

function wrapCache(provider: Provider, options: { noCache?: boolean; cacheDir?: string }): Provider {
  if (options.noCache) return provider
  if (options.cacheDir) return new CachedProvider(provider, options.cacheDir)
  return new CachedProvider(provider)
}
