import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../../src/config/loader.js'
import { ConfigError } from '../../src/infra/errors.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): string => resolve(here, '..', 'fixtures', 'suites', name)

describe('loadConfig', () => {
  it('loads a valid suite with all assertion types', async () => {
    const cfg = await loadConfig(fixture('valid.yaml'))
    expect(cfg.model).toBe('gpt-4o')
    expect(cfg.judge_model).toBe('gpt-4o-mini')
    expect(cfg.runs_per_test).toBe(2)
    expect(cfg.concurrency).toBe(3)
    expect(cfg.tests).toHaveLength(2)
    expect(cfg.tests[0]?.assert).toHaveLength(2)
  })

  it('applies defaults when optional fields are omitted', async () => {
    const cfg = await loadConfig(fixture('minimal.yaml'))
    expect(cfg.judge_model).toBe('gpt-4o-mini')
    expect(cfg.runs_per_test).toBe(1)
    expect(cfg.concurrency).toBe(5)
  })

  it('rejects empty test arrays', async () => {
    await expect(loadConfig(fixture('invalid-missing-tests.yaml'))).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects unknown assertion types', async () => {
    await expect(loadConfig(fixture('invalid-assert.yaml'))).rejects.toBeInstanceOf(ConfigError)
  })

  it('throws ConfigError for a missing file', async () => {
    await expect(loadConfig(fixture('does-not-exist.yaml'))).rejects.toBeInstanceOf(ConfigError)
  })
})
