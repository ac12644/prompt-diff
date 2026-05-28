import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { orchestrateSuggest } from '../../src/suggest.js'
import { MockProvider } from '../../src/providers/mock.js'
import type { Provider } from '../../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = (...parts: string[]): string => resolve(here, '..', 'fixtures', ...parts)

describe('orchestrateSuggest (integration, mock providers, no network)', () => {
  let workDir: string
  let promptPath: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'promptdiff-suggest-'))
    promptPath = join(workDir, 'baseline.txt')
    await writeFile(promptPath, 'You are concise. Reply briefly.\n', 'utf8')
  })
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('accepts a suggestion that beats baseline on every assertion', async () => {
    // Baseline returns outputs that fail; rewritten prompt returns outputs that pass.
    const factory = (model: string): Provider => {
      if (model === 'claude-opus-4-7') {
        // Rewriter returns an improved prompt.
        return new MockProvider(model, () => 'You are friendly. Reply briefly. Always say hello and thank you.')
      }
      if (model === 'gpt-4o-mini') {
        // Judge prefers the suggestion.
        return new MockProvider(model, () => '{"winner":"B","scoreA":40,"scoreB":95,"reason":"v2 fixes the missing greeting"}')
      }
      // Main model: baseline output fails contains-"hello"; suggestion output passes.
      return new MockProvider(model, (prompt) =>
        prompt.includes('friendly') ? 'hello, thank you!' : 'sure',
      )
    }

    const report = await orchestrateSuggest(
      promptPath,
      fixturePath('suites', 'integration.yaml'),
      {
        apiKeys: { anthropic: 'sk-ant-test', openai: 'sk-test' },
        suggesterModel: 'claude-opus-4-7',
        noCache: true,
        providerFactory: factory,
      },
    )

    expect(report.suggestedPrompt).toContain('friendly')
    expect(report.weaknesses.length).toBeGreaterThan(0)
    expect(report.diff.regressionScore).toBeGreaterThanOrEqual(90)
    expect(report.accepted).toBe(true)
  })

  it('rejects a suggestion that regresses behavior', async () => {
    const factory = (model: string): Provider => {
      if (model === 'claude-opus-4-7') {
        return new MockProvider(model, () => 'A worse rewritten prompt that does not help.')
      }
      if (model === 'gpt-4o-mini') {
        return new MockProvider(model, () => '{"winner":"A","scoreA":90,"scoreB":20,"reason":"v2 broke things"}')
      }
      // Baseline output passes the contains check; suggestion fails it.
      return new MockProvider(model, (prompt) =>
        prompt.includes('worse') ? 'no greeting' : 'hello there friend',
      )
    }

    const report = await orchestrateSuggest(
      promptPath,
      fixturePath('suites', 'integration.yaml'),
      {
        apiKeys: { anthropic: 'sk-ant-test', openai: 'sk-test' },
        suggesterModel: 'claude-opus-4-7',
        noCache: true,
        providerFactory: factory,
      },
    )

    expect(report.accepted).toBe(false)
    expect(report.diff.regressionScore).toBeLessThan(90)
  })

  it('writes the suggested prompt to outputPath when provided', async () => {
    const outputPath = join(workDir, 'suggested.txt')
    const factory = (model: string): Provider => {
      if (model === 'claude-opus-4-7') {
        return new MockProvider(model, () => 'A new prompt that includes hello.')
      }
      if (model === 'gpt-4o-mini') {
        return new MockProvider(model, () => '{"winner":"B","scoreA":60,"scoreB":92,"reason":"better"}')
      }
      return new MockProvider(model, () => 'hello world')
    }

    await orchestrateSuggest(
      promptPath,
      fixturePath('suites', 'integration.yaml'),
      {
        apiKeys: { anthropic: 'sk-ant-test', openai: 'sk-test' },
        suggesterModel: 'claude-opus-4-7',
        outputPath,
        noCache: true,
        providerFactory: factory,
      },
    )

    const saved = await readFile(outputPath, 'utf8')
    expect(saved.trim()).toBe('A new prompt that includes hello.')
  })

  it('strips markdown fences from the rewriter response', async () => {
    const factory = (model: string): Provider => {
      if (model === 'claude-opus-4-7') {
        return new MockProvider(model, () =>
          "Here's the rewritten prompt:\n```\nYou are warm. Say hello.\n```",
        )
      }
      if (model === 'gpt-4o-mini') {
        return new MockProvider(model, () => '{"winner":"tie","scoreA":80,"scoreB":80,"reason":"tied"}')
      }
      return new MockProvider(model, () => 'hello there')
    }

    const report = await orchestrateSuggest(
      promptPath,
      fixturePath('suites', 'integration.yaml'),
      {
        apiKeys: { anthropic: 'sk-ant-test', openai: 'sk-test' },
        suggesterModel: 'claude-opus-4-7',
        noCache: true,
        providerFactory: factory,
      },
    )

    expect(report.suggestedPrompt).toBe('You are warm. Say hello.')
    expect(report.suggestedPrompt).not.toContain('```')
    expect(report.suggestedPrompt).not.toContain('rewritten prompt')
  })
})
