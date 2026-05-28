import { describe, it, expect } from 'vitest'
import {
  computeCost,
  computeCostWithTable,
  priceTableMeta,
  type PriceTable,
} from '../../src/providers/cost.js'

// Stable in-memory table used for deterministic assertions about lookup behavior.
// Real upstream prices change; we shouldn't assert exact dollars against them.
const STUB: PriceTable = {
  'gpt-4o':         { input_cost_per_token: 2.5e-6, output_cost_per_token: 1.0e-5 },
  'gpt-4o-mini':    { input_cost_per_token: 1.5e-7, output_cost_per_token: 6.0e-7 },
  'claude-3-5-sonnet': { input_cost_per_token: 3.0e-6, output_cost_per_token: 1.5e-5 },
  'gemini-2.5-flash':      { input_cost_per_token: 3.0e-7, output_cost_per_token: 2.5e-6 },
  'gemini-2.5-flash-lite': { input_cost_per_token: 1.0e-7, output_cost_per_token: 4.0e-7 },
  'gpt-5':       { input_cost_per_token: 1.25e-6, output_cost_per_token: 1.0e-5 },
  'gpt-5-mini':  { input_cost_per_token: 2.5e-7, output_cost_per_token: 2.0e-6 },
}

describe('computeCostWithTable (pure lookup)', () => {
  it('computes cost from per-token rates', () => {
    expect(computeCostWithTable(STUB, 'gpt-4o', 1_000_000, 0)).toBeCloseTo(2.5, 5)
    expect(computeCostWithTable(STUB, 'gpt-4o', 0, 1_000_000)).toBeCloseTo(10.0, 5)
  })

  it('zero tokens cost zero', () => {
    expect(computeCostWithTable(STUB, 'gpt-4o', 0, 0)).toBe(0)
  })

  it('uses fallback for unknown models', () => {
    // FALLBACK = $1/M input, $3/M output
    expect(computeCostWithTable(STUB, 'unknown-mystery', 1_000_000, 0)).toBeCloseTo(1.0, 5)
    expect(computeCostWithTable(STUB, 'unknown-mystery', 0, 1_000_000)).toBeCloseTo(3.0, 5)
  })

  it('prefix-matches dated model ids to the base entry', () => {
    expect(computeCostWithTable(STUB, 'claude-3-5-sonnet-20241022', 1_000_000, 0)).toBeCloseTo(3.0, 5)
  })

  it('longest-prefix match prefers gpt-5-mini over gpt-5 for gpt-5-mini-2025-XX', () => {
    const dated = computeCostWithTable(STUB, 'gpt-5-mini-2025-08-01', 1_000_000, 0)
    const base  = computeCostWithTable(STUB, 'gpt-5-mini', 1_000_000, 0)
    expect(dated).toBeCloseTo(base, 5)
  })

  it('longest-prefix match for Gemini prefers -lite over base flash', () => {
    const lite  = computeCostWithTable(STUB, 'gemini-2.5-flash-lite-2026-04', 1_000_000, 0)
    const flash = computeCostWithTable(STUB, 'gemini-2.5-flash-2026-04',      1_000_000, 0)
    expect(lite).toBeCloseTo(0.10, 5)
    expect(flash).toBeCloseTo(0.30, 5)
  })
})

describe('computeCost (bundled price table)', () => {
  it('returns a non-zero cost for known models', () => {
    // Exact dollar values come from upstream LiteLLM and may shift over time, so we
    // only assert structural invariants here, not specific prices.
    const cost = computeCost('gpt-4o', 1_000_000, 0)
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(100)
  })

  it('output tokens cost at least as much as input tokens (per-token) for typical models', () => {
    const inputCost  = computeCost('gpt-4o', 1000, 0)
    const outputCost = computeCost('gpt-4o', 0, 1000)
    expect(outputCost).toBeGreaterThanOrEqual(inputCost)
  })

  it('falls back to a non-zero estimate for unknown models', () => {
    const cost = computeCost('totally-unknown-future-model', 1_000_000, 0)
    expect(cost).toBeGreaterThan(0)
  })

  it('exposes the bundled snapshot metadata', () => {
    const meta = priceTableMeta()
    expect(meta.entryCount).toBeGreaterThan(0)
    expect(meta.fetchedAt).toBeTruthy()
  })
})
