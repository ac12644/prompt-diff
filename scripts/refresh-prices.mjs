#!/usr/bin/env node
// Refresh src/providers/prices.json from LiteLLM's community-maintained registry.
// Filters to entries whose litellm_provider is in our supported set, so the bundled
// snapshot stays small (~200 entries instead of 2700+).
//
// Run: npm run refresh-prices
// Upstream: https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
//
// Note: this file is intentionally a build-time tool, not a runtime dep. We commit
// the resulting prices.json snapshot so installs work offline and CI is deterministic.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SOURCE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const SUPPORTED_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'gemini',
  'vertex_ai-language-models',  // Gemini via Vertex (same prices, useful as a parallel key)
])

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '..', 'src', 'providers', 'prices.json')

console.log(`Fetching ${SOURCE_URL} …`)
const res = await fetch(SOURCE_URL)
if (!res.ok) {
  console.error(`HTTP ${res.status} from upstream`)
  process.exit(1)
}
const all = await res.json()

const filtered = {}
let kept = 0
for (const [model, entry] of Object.entries(all)) {
  if (model === 'sample_spec') continue
  if (typeof entry !== 'object' || entry === null) continue
  if (!SUPPORTED_PROVIDERS.has(entry.litellm_provider)) continue
  if (entry.mode !== 'chat' && entry.mode !== 'completion' && entry.mode !== 'responses') continue
  // Slash-prefixed duplicates (e.g. `gemini/gemini-2.5-flash`) carry the same prices
  // as the bare entry. Skip them; our model IDs are passed bare to the SDK.
  if (model.includes('/')) continue
  filtered[model] = {
    input_cost_per_token:  entry.input_cost_per_token  ?? 0,
    output_cost_per_token: entry.output_cost_per_token ?? 0,
    litellm_provider: entry.litellm_provider,
  }
  kept++
}

const out = {
  _meta: {
    source: SOURCE_URL,
    fetched_at: new Date().toISOString(),
    entry_count: kept,
    providers: [...SUPPORTED_PROVIDERS],
  },
  models: filtered,
}

await writeFile(target, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`Wrote ${kept} entries to ${target}`)
