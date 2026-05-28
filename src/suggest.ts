import { writeFile } from 'node:fs/promises'
import { computeTextDiff } from './core/differ/differ.js'
import { runTestSuite } from './core/runner/runner.js'
import { judgeAllResults } from './core/judge/judge.js'
import { computeReport } from './core/scorer/scorer.js'
import { loadConfig, readPromptFile } from './config/loader.js'
import { createProvider as defaultCreateProvider } from './providers/index.js'
import { CachedProvider } from './infra/cache.js'
import {
  analyzeWeaknesses,
  buildRewriteRequest,
  extractRewrittenPrompt,
} from './core/suggester/suggester.js'
import { ProviderError } from './infra/errors.js'
import type {
  Provider, ProviderKeys, SuggestOptions, SuggestionReport, ProviderKeys as PK,
} from './types.js'
import type { ProviderFactory } from './orchestrate.js'

const DEFAULT_MIN_IMPROVEMENT = 90

/** Internal options layer that lets tests inject a provider factory. */
export type SuggestInternals = SuggestOptions & {
  providerFactory?: ProviderFactory
}

/**
 * The hero pipeline: take a prompt + suite, ask a strong LLM to rewrite it,
 * verify the rewrite actually beats the original on the same suite, return
 * a SuggestionReport.
 */
export async function orchestrateSuggest(
  promptPath: string,
  suitePath: string,
  options: SuggestInternals = {},
): Promise<SuggestionReport> {
  const config = await loadConfig(suitePath)
  const originalPrompt = await readPromptFile(promptPath)

  const keys = options.apiKeys ?? {}
  const factory = options.providerFactory ?? defaultCreateProvider
  const suggesterModel = options.suggesterModel ?? defaultSuggesterModel(keys)

  // Phase 1 — run baseline through the suite.
  const runProvider = wrapCache(factory(config.model, keys), options)
  const baselineResults = await runTestSuite(config, originalPrompt, 'v1', runProvider)

  // Phase 2 — identify weaknesses, ask the rewriter LLM for a candidate.
  const weaknesses = analyzeWeaknesses(config.tests, baselineResults)
  const request = buildRewriteRequest(originalPrompt, config.tests, baselineResults, weaknesses)
  const suggesterProvider = factory(suggesterModel, keys)
  const rawSuggestion = await suggesterProvider.complete(request.systemPrompt, request.userInput)
  const suggestedPrompt = extractRewrittenPrompt(rawSuggestion.output)

  if (suggestedPrompt.length === 0) {
    throw new ProviderError(`Rewriter returned empty output (model: ${suggesterModel})`)
  }

  // Phase 3 — score the suggestion against the same suite.
  const suggestionResults = await runTestSuite(config, suggestedPrompt, 'v2', runProvider)

  // Phase 4 — judge baseline vs suggestion using existing pipeline.
  const judgeProvider = factory(config.judge_model, keys)
  const judgeResults = await judgeAllResults(baselineResults, suggestionResults, config, judgeProvider)
  const textDiff = computeTextDiff(originalPrompt, suggestedPrompt, config.model)
  const diff = computeReport(judgeResults, textDiff, baselineResults, suggestionResults)

  // Phase 5 — write the suggestion if requested.
  if (options.outputPath) {
    await writeFile(options.outputPath, suggestedPrompt + '\n', 'utf8')
  }

  const minImprovement = options.minImprovement ?? DEFAULT_MIN_IMPROVEMENT
  const accepted = diff.verdict !== 'fail' && diff.regressionScore >= minImprovement

  return {
    originalPrompt,
    suggestedPrompt,
    suggesterModel,
    weaknesses,
    baselineResults,
    suggestionResults,
    diff,
    accepted,
  }
}

function wrapCache(provider: Provider, options: { noCache?: boolean; cacheDir?: string }): Provider {
  if (options.noCache) return provider
  if (options.cacheDir) return new CachedProvider(provider, options.cacheDir)
  return new CachedProvider(provider)
}

/**
 * Pick a reasonable strong-model default based on which keys are available.
 * Anthropic > OpenAI > Gemini ordering since Claude Opus tends to give the
 * least-sycophantic rewrites in practice. Override with --suggester.
 */
function defaultSuggesterModel(keys: ProviderKeys): string {
  if (keys.anthropic) return 'claude-opus-4-7'
  if (keys.openai)    return 'gpt-5'
  if (keys.gemini)    return 'gemini-2.5-pro'
  throw new ProviderError(
    'No API key available for the rewriter. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY, ' +
    'or pass --suggester <model> with the matching key.',
  )
}
