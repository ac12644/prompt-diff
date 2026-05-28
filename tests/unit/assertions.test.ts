import { describe, it, expect } from 'vitest'
import { evaluate, evaluateForVersion } from '../../src/core/judge/assertions.js'

describe('evaluate', () => {
  it('contains passes when output includes value', () => {
    const r = evaluate({ type: 'contains', value: 'hello' }, 'hello world')
    expect(r.passed).toBe(true)
  })

  it('contains fails when value missing', () => {
    const r = evaluate({ type: 'contains', value: 'goodbye' }, 'hello world')
    expect(r.passed).toBe(false)
  })

  it('not_contains passes when value is absent', () => {
    const r = evaluate({ type: 'not_contains', value: 'unfortunately' }, 'we will help')
    expect(r.passed).toBe(true)
  })

  it('not_contains fails when value is present', () => {
    const r = evaluate({ type: 'not_contains', value: 'sorry' }, 'sorry about that')
    expect(r.passed).toBe(false)
  })

  it('length_under passes for short output', () => {
    const r = evaluate({ type: 'length_under', value: 100 }, 'short')
    expect(r.passed).toBe(true)
  })

  it('length_under fails for long output', () => {
    const r = evaluate({ type: 'length_under', value: 5 }, 'much longer than five')
    expect(r.passed).toBe(false)
  })

  it('starts_with ignores leading whitespace', () => {
    const r = evaluate({ type: 'starts_with', value: '1.' }, '   1. first item')
    expect(r.passed).toBe(true)
  })

  it('starts_with fails when prefix differs', () => {
    const r = evaluate({ type: 'starts_with', value: '1.' }, 'Hello there')
    expect(r.passed).toBe(false)
  })

  it('regex passes on match', () => {
    const r = evaluate({ type: 'regex', value: '^[A-Z]\\w+' }, 'Hello')
    expect(r.passed).toBe(true)
  })

  it('regex fails on no match', () => {
    const r = evaluate({ type: 'regex', value: '^\\d+$' }, 'abc')
    expect(r.passed).toBe(false)
  })

  it('regex treats malformed pattern as failure rather than throwing', () => {
    const r = evaluate({ type: 'regex', value: '(unbalanced' }, 'whatever')
    expect(r.passed).toBe(false)
  })

  it('llm_judge throws — routed through judge module', () => {
    expect(() => evaluate({ type: 'llm_judge', criteria: 'is friendly' }, 'hi')).toThrow()
  })

  it('evaluateForVersion stamps the version on the result', () => {
    const r = evaluateForVersion({ type: 'contains', value: 'hi' }, 'hi there', 'v2')
    expect(r.version).toBe('v2')
    expect(r.passed).toBe(true)
  })
})
