import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { logger } from '../infra/logger.js'

/**
 * Per-token prices in USD, sourced from LiteLLM's community-maintained registry.
 * No provider returns cost in the response — we compute it client-side from token counts.
 *
 * The registry snapshot lives at src/providers/prices.json and is refreshed by
 * `npm run refresh-prices`. Run that whenever a model price changes upstream.
 * Upstream: https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
 */

export type ModelPricing = {
  input_cost_per_token: number
  output_cost_per_token: number
}

export type PriceTable = Record<string, ModelPricing>

type PricesFile = {
  _meta?: { source?: string; fetched_at?: string; entry_count?: number }
  models: PriceTable
}

// Fallback used when a model is not in the registry. Conservative-ish averages —
// enough to surface a non-zero cost delta so reports don't read as $0.
const FALLBACK: ModelPricing = { input_cost_per_token: 1e-6, output_cost_per_token: 3e-6 }

const BUNDLED = loadBundledPrices()
const DEFAULT_KEYS_BY_LENGTH = Object.keys(BUNDLED.table).sort((a, b) => b.length - a.length)

/** Compute USD cost for one call using the bundled price table. */
export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  return computeCostWithTable(BUNDLED.table, model, inputTokens, outputTokens, DEFAULT_KEYS_BY_LENGTH)
}

/**
 * Cost calculation against an explicit price table — pure, no globals.
 * Used in tests so assertions don't break when LiteLLM refreshes upstream prices.
 */
export function computeCostWithTable(
  table: PriceTable,
  model: string,
  inputTokens: number,
  outputTokens: number,
  sortedKeys?: string[],
): number {
  const pricing = lookup(table, model, sortedKeys)
  return inputTokens * pricing.input_cost_per_token + outputTokens * pricing.output_cost_per_token
}

/** Report the date and entry count of the bundled price snapshot. */
export function priceTableMeta(): { fetchedAt?: string; entryCount: number } {
  return { fetchedAt: BUNDLED.meta?.fetched_at, entryCount: Object.keys(BUNDLED.table).length }
}

function loadBundledPrices(): { table: PriceTable; meta?: PricesFile['_meta'] } {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const path = resolve(here, 'prices.json')
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PricesFile
    return { table: parsed.models, meta: parsed._meta }
  } catch (err) {
    logger.warn(`could not load bundled price table; falling back: ${(err as Error).message}`)
    return { table: {} }
  }
}

function lookup(table: PriceTable, model: string, sortedKeys?: string[]): ModelPricing {
  const exact = table[model]
  if (exact) return exact

  // Longest-prefix match so `gpt-5-mini-2025-XX` hits `gpt-5-mini` rather than `gpt-5`.
  const keys = sortedKeys ?? Object.keys(table).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (model.startsWith(key)) {
      const match = table[key]
      if (match) return match
    }
  }
  return FALLBACK
}
