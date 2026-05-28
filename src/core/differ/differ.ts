import { countTokens } from './tokenizer.js'
import type { TextDiff } from '../../types.js'

/** Compare two prompt strings: line-level added/removed counts plus token delta. */
export function computeTextDiff(a: string, b: string, model: string): TextDiff {
  const { added, removed } = countLineChanges(a, b)
  const aTokens = countTokens(a, model)
  const bTokens = countTokens(b, model)
  const tokenDelta = bTokens - aTokens
  const tokenDeltaPercent = aTokens === 0 ? 0 : (tokenDelta / aTokens) * 100

  return { added, removed, tokenDelta, tokenDeltaPercent }
}

function countLineChanges(a: string, b: string): { added: number; removed: number } {
  const aLines = a === '' ? [] : a.split('\n')
  const bLines = b === '' ? [] : b.split('\n')

  const aRemaining = new Map<string, number>()
  for (const line of aLines) aRemaining.set(line, (aRemaining.get(line) ?? 0) + 1)

  let added = 0
  for (const line of bLines) {
    const left = aRemaining.get(line) ?? 0
    if (left > 0) aRemaining.set(line, left - 1)
    else added++
  }

  let removed = 0
  for (const count of aRemaining.values()) removed += count

  return { added, removed }
}
