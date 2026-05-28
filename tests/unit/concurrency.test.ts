import { describe, it, expect } from 'vitest'
import { withConcurrencyLimit } from '../../src/core/runner/concurrency.js'

describe('withConcurrencyLimit', () => {
  it('preserves task result order', async () => {
    const results = await withConcurrencyLimit(
      [1, 2, 3, 4].map(n => async () => n * 10),
      2,
    )
    expect(results).toEqual([10, 20, 30, 40])
  })

  it('never runs more than `limit` tasks concurrently', async () => {
    let inFlight = 0
    let peak = 0
    const tasks = Array.from({ length: 20 }, () => async () => {
      inFlight++
      if (inFlight > peak) peak = inFlight
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return null
    })
    await withConcurrencyLimit(tasks, 3)
    expect(peak).toBeLessThanOrEqual(3)
  })
})
