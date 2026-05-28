import { describe, it, expect } from 'vitest'
import { countTokens } from '../../src/core/differ/tokenizer.js'

describe('countTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(countTokens('', 'gpt-4o')).toBe(0)
  })

  it('returns a positive count for non-empty text', () => {
    expect(countTokens('hello world', 'gpt-4o')).toBeGreaterThan(0)
  })

  it('falls back to default encoding for unknown models', () => {
    expect(countTokens('hello world', 'claude-3-5-sonnet-20241022')).toBeGreaterThan(0)
  })

  it('counts longer text as more tokens', () => {
    const short = countTokens('hi', 'gpt-4o')
    const long = countTokens('hi '.repeat(50), 'gpt-4o')
    expect(long).toBeGreaterThan(short)
  })
})
