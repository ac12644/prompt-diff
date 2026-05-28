import { describe, it, expect } from 'vitest'
import { computeTextDiff } from '../../src/core/differ/differ.js'

describe('computeTextDiff', () => {
  it('returns zero delta for identical prompts', () => {
    const result = computeTextDiff('same prompt', 'same prompt', 'gpt-4o')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.tokenDelta).toBe(0)
    expect(result.tokenDeltaPercent).toBe(0)
  })

  it('counts added lines correctly', () => {
    const result = computeTextDiff('line one', 'line one\nline two', 'gpt-4o')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.tokenDelta).toBeGreaterThan(0)
    expect(result.tokenDeltaPercent).toBeGreaterThan(0)
  })

  it('counts removed lines correctly', () => {
    const result = computeTextDiff('a\nb\nc', 'a', 'gpt-4o')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(2)
    expect(result.tokenDelta).toBeLessThan(0)
  })

  it('counts both added and removed lines', () => {
    const result = computeTextDiff('a\nb', 'a\nc', 'gpt-4o')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
  })

  it('handles two empty strings', () => {
    const result = computeTextDiff('', '', 'gpt-4o')
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.tokenDelta).toBe(0)
    expect(result.tokenDeltaPercent).toBe(0)
  })

  it('handles empty v1 with non-empty v2 without dividing by zero', () => {
    const result = computeTextDiff('', 'hello world', 'gpt-4o')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.tokenDelta).toBeGreaterThan(0)
    expect(result.tokenDeltaPercent).toBe(0)
  })
})
