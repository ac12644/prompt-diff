import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runCli,
  EXIT_OK,
  EXIT_REGRESSION,
  EXIT_CONFIG,
} from '../../src/cli/index.js'
import { MockProvider } from '../../src/providers/mock.js'
import type { Provider } from '../../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = (...parts: string[]): string => resolve(here, '..', 'fixtures', ...parts)

function makeStderr(): { write: (s: string) => void; output: string } {
  const state = { value: '' }
  return {
    write(s) { state.value += s },
    get output() { return state.value },
  }
}

const passingFactory = (model: string): Provider => {
  if (model === 'gpt-4o-mini') {
    return new MockProvider(model, () => '{"winner":"tie","scoreA":95,"scoreB":95,"reason":"both ok"}')
  }
  return new MockProvider(model, (_p, input) => `hello thank you ${input}`)
}

const failingFactory = (model: string): Provider => {
  if (model === 'gpt-4o-mini') {
    return new MockProvider(model, () => '{"winner":"A","scoreA":95,"scoreB":10,"reason":"v2 worse"}')
  }
  return new MockProvider(model, () => 'unfortunately broken')
}

describe('runCli (end-to-end via injected provider factory)', () => {
  let cacheDir: string
  let env: Record<string, string | undefined>

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'promptdiff-cli-'))
    env = { PROMPTDIFF_CACHE_DIR: cacheDir }
  })
  afterEach(async () => {
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
  })

  it('returns EXIT_OK on a clean run', async () => {
    const stderr = makeStderr()
    const code = await runCli(
      [
        'node', 'promptdiff',
        fixturePath('prompts', 'v1.txt'),
        fixturePath('prompts', 'v2.txt'),
        '-s', fixturePath('suites', 'integration.yaml'),
        '--format', 'json',
      ],
      { env, providerFactory: passingFactory, stderr },
    )
    expect(code).toBe(EXIT_OK)
  })

  it('returns EXIT_REGRESSION when score falls below --min-score', async () => {
    const stderr = makeStderr()
    const code = await runCli(
      [
        'node', 'promptdiff',
        fixturePath('prompts', 'v1.txt'),
        fixturePath('prompts', 'v2.txt'),
        '-s', fixturePath('suites', 'integration.yaml'),
        '--min-score', '90',
        '--format', 'json',
      ],
      { env, providerFactory: failingFactory, stderr },
    )
    expect(code).toBe(EXIT_REGRESSION)
  })

  it('returns EXIT_CONFIG when suite file is missing', async () => {
    const stderr = makeStderr()
    const code = await runCli(
      [
        'node', 'promptdiff',
        fixturePath('prompts', 'v1.txt'),
        fixturePath('prompts', 'v2.txt'),
        '-s', fixturePath('suites', 'does-not-exist.yaml'),
        '--format', 'json',
      ],
      { env, providerFactory: passingFactory, stderr },
    )
    expect(code).toBe(EXIT_CONFIG)
    expect(stderr.output).toContain('Config error')
  })

  it('returns EXIT_CONFIG when required --suite flag is missing', async () => {
    const stderr = makeStderr()
    const code = await runCli(
      [
        'node', 'promptdiff',
        fixturePath('prompts', 'v1.txt'),
        fixturePath('prompts', 'v2.txt'),
      ],
      { env, providerFactory: passingFactory, stderr },
    )
    expect(code).toBe(EXIT_CONFIG)
  })
})
