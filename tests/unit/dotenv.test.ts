import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDotenv } from '../../src/infra/dotenv.js'

describe('loadDotenv', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'promptdiff-dotenv-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns 0 silently when .env is missing', () => {
    const env: Record<string, string | undefined> = {}
    expect(loadDotenv(dir, env)).toBe(0)
    expect(env).toEqual({})
  })

  it('parses KEY=VALUE lines', async () => {
    await writeFile(join(dir, '.env'), 'OPENAI_API_KEY=sk-1\nANTHROPIC_API_KEY=sk-ant-2\n')
    const env: Record<string, string | undefined> = {}
    expect(loadDotenv(dir, env)).toBe(2)
    expect(env.OPENAI_API_KEY).toBe('sk-1')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-2')
  })

  it('ignores blank lines and # comments', async () => {
    await writeFile(join(dir, '.env'), [
      '# top comment',
      '',
      'KEY=value',
      '# another comment',
      '   ',
      'OTHER=x',
    ].join('\n'))
    const env: Record<string, string | undefined> = {}
    expect(loadDotenv(dir, env)).toBe(2)
    expect(env.KEY).toBe('value')
    expect(env.OTHER).toBe('x')
  })

  it('strips surrounding single and double quotes', async () => {
    await writeFile(join(dir, '.env'), 'A="quoted value"\nB=\'single quoted\'\nC=bare\n')
    const env: Record<string, string | undefined> = {}
    loadDotenv(dir, env)
    expect(env.A).toBe('quoted value')
    expect(env.B).toBe('single quoted')
    expect(env.C).toBe('bare')
  })

  it('preserves existing env values (explicit env wins)', async () => {
    await writeFile(join(dir, '.env'), 'KEEPME=from-dotenv\n')
    const env: Record<string, string | undefined> = { KEEPME: 'from-shell' }
    expect(loadDotenv(dir, env)).toBe(0)
    expect(env.KEEPME).toBe('from-shell')
  })

  it('strips inline # comments from unquoted values only', async () => {
    await writeFile(join(dir, '.env'), 'A=value # comment\nB="value # not a comment"\n')
    const env: Record<string, string | undefined> = {}
    loadDotenv(dir, env)
    expect(env.A).toBe('value')
    expect(env.B).toBe('value # not a comment')
  })

  it('rejects lines with invalid key names', async () => {
    await writeFile(join(dir, '.env'), 'valid=ok\n123_bad=skip\n-also-bad=skip\n')
    const env: Record<string, string | undefined> = {}
    expect(loadDotenv(dir, env)).toBe(1)
    expect(env.valid).toBe('ok')
  })
})
