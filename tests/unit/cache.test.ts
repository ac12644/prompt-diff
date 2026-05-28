import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CachedProvider } from '../../src/infra/cache.js'
import { MockProvider } from '../../src/providers/mock.js'

describe('CachedProvider', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'promptdiff-cache-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the inner result and writes to cache on miss', async () => {
    const inner = new MockProvider('gpt-4o', () => 'hello')
    const cache = new CachedProvider(inner, dir)
    const result = await cache.complete('sys', 'in')
    expect(result.output).toBe('hello')
    expect(inner.stats().callCount).toBe(1)
    expect((await readdir(dir)).length).toBe(1)
  })

  it('skips inner provider on cache hit', async () => {
    const inner = new MockProvider('gpt-4o', () => 'hello')
    const cache = new CachedProvider(inner, dir)
    await cache.complete('sys', 'in')
    const second = await cache.complete('sys', 'in')
    expect(second.output).toBe('hello')
    expect(inner.stats().callCount).toBe(1)
  })

  it('uses different keys for different inputs', async () => {
    let n = 0
    const inner = new MockProvider('gpt-4o', () => `call-${++n}`)
    const cache = new CachedProvider(inner, dir)
    const a = await cache.complete('sys', 'a')
    const b = await cache.complete('sys', 'b')
    expect(a.output).toBe('call-1')
    expect(b.output).toBe('call-2')
  })

  it('uses different keys for different models', async () => {
    const inner4o   = new MockProvider('gpt-4o',      () => 'A')
    const innerMini = new MockProvider('gpt-4o-mini', () => 'B')
    const cacheA = new CachedProvider(inner4o,   dir)
    const cacheB = new CachedProvider(innerMini, dir)
    await cacheA.complete('sys', 'x')
    await cacheB.complete('sys', 'x')
    expect(inner4o.stats().callCount).toBe(1)
    expect(innerMini.stats().callCount).toBe(1)
  })

  it('treats corrupted cache files as a miss and re-fetches', async () => {
    const inner = new MockProvider('gpt-4o', () => 'fresh')
    const cache = new CachedProvider(inner, dir)
    await cache.complete('sys', 'x')
    for (const file of await readdir(dir)) {
      await writeFile(join(dir, file), 'not valid json {')
    }
    const result = await cache.complete('sys', 'x')
    expect(result.output).toBe('fresh')
    expect(inner.stats().callCount).toBe(2)
  })

  it('continues without throwing when cache write fails', async () => {
    const blockedDir = join(dir, 'blocked')
    await writeFile(blockedDir, 'this is a file, not a directory')
    const inner = new MockProvider('gpt-4o', () => 'still works')
    const cache = new CachedProvider(inner, blockedDir)
    const result = await cache.complete('sys', 'x')
    expect(result.output).toBe('still works')
  })
})
