import { describe, it, expect } from 'vitest'
import { OpenAIProvider, type OpenAIChatClient } from '../../src/providers/openai.js'
import { AnthropicProvider, type AnthropicMessagesClient } from '../../src/providers/anthropic.js'
import { GeminiProvider, type GeminiClient } from '../../src/providers/gemini.js'
import { createProvider } from '../../src/providers/index.js'
import { ProviderError } from '../../src/infra/errors.js'

function stubOpenAI(behavior: () => Promise<unknown>): OpenAIChatClient {
  return {
    chat: {
      completions: {
        create: () => behavior() as ReturnType<OpenAIChatClient['chat']['completions']['create']>,
      },
    },
  }
}

function stubAnthropic(behavior: () => Promise<unknown>): AnthropicMessagesClient {
  return {
    messages: {
      create: () => behavior() as ReturnType<AnthropicMessagesClient['messages']['create']>,
    },
  }
}

function stubGemini(behavior: () => Promise<unknown>): GeminiClient {
  return {
    models: {
      generateContent: () => behavior() as ReturnType<GeminiClient['models']['generateContent']>,
    },
  }
}

describe('OpenAIProvider', () => {
  it('maps a successful response to a RunResult', async () => {
    const client = stubOpenAI(async () => ({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }))
    const provider = new OpenAIProvider('gpt-4o', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('hello')
    expect(result.inputTokens).toBe(12)
    expect(result.outputTokens).toBe(4)
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('wraps SDK errors as ProviderError preserving the message', async () => {
    const client = stubOpenAI(async () => { throw new Error('rate limited') })
    const provider = new OpenAIProvider('gpt-4o', client)
    await expect(provider.complete('sys', 'in')).rejects.toBeInstanceOf(ProviderError)
    await expect(provider.complete('sys', 'in')).rejects.toThrow(/rate limited/)
  })

  it('handles missing content fields gracefully', async () => {
    const client = stubOpenAI(async () => ({ choices: [], usage: null }))
    const provider = new OpenAIProvider('gpt-4o', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('')
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })
})

describe('AnthropicProvider', () => {
  it('concatenates text blocks and reads usage', async () => {
    const client = stubAnthropic(async () => ({
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
      usage: { input_tokens: 20, output_tokens: 10 },
    }))
    const provider = new AnthropicProvider('claude-3-5-sonnet-20241022', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('hello world')
    expect(result.inputTokens).toBe(20)
    expect(result.outputTokens).toBe(10)
  })

  it('wraps SDK errors as ProviderError', async () => {
    const client = stubAnthropic(async () => { throw new Error('overloaded') })
    const provider = new AnthropicProvider('claude-3-5-sonnet', client)
    await expect(provider.complete('sys', 'in')).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('GeminiProvider', () => {
  it('reads response.text when present and extracts usage', async () => {
    const client = stubGemini(async () => ({
      text: 'hello from gemini',
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    }))
    const provider = new GeminiProvider('gemini-2.5-flash', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('hello from gemini')
    expect(result.inputTokens).toBe(11)
    expect(result.outputTokens).toBe(7)
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('falls back to candidates[0].content.parts when response.text is absent', async () => {
    const client = stubGemini(async () => ({
      candidates: [{ content: { parts: [{ text: 'piece one ' }, { text: 'piece two' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    }))
    const provider = new GeminiProvider('gemini-2.5-flash', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('piece one piece two')
  })

  it('wraps SDK errors as ProviderError preserving the message', async () => {
    const client = stubGemini(async () => { throw new Error('quota exceeded') })
    const provider = new GeminiProvider('gemini-2.5-flash', client)
    await expect(provider.complete('sys', 'in')).rejects.toBeInstanceOf(ProviderError)
    await expect(provider.complete('sys', 'in')).rejects.toThrow(/quota exceeded/)
  })

  it('handles missing usage and empty candidates without crashing', async () => {
    const client = stubGemini(async () => ({}))
    const provider = new GeminiProvider('gemini-2.5-flash', client)
    const result = await provider.complete('sys', 'in')
    expect(result.output).toBe('')
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })
})

describe('createProvider', () => {
  it('dispatches gpt-* to OpenAI', () => {
    const provider = createProvider('gpt-4o', { openai: 'sk-test' })
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  it('dispatches o1-* to OpenAI', () => {
    const provider = createProvider('o1-mini', { openai: 'sk-test' })
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  it('dispatches claude-* to Anthropic', () => {
    const provider = createProvider('claude-3-5-sonnet-20241022', { anthropic: 'sk-ant-test' })
    expect(provider).toBeInstanceOf(AnthropicProvider)
  })

  it('dispatches gemini-* to Gemini', () => {
    const provider = createProvider('gemini-2.5-flash', { gemini: 'AIza-test' })
    expect(provider).toBeInstanceOf(GeminiProvider)
  })

  it('dispatches o3-* to OpenAI', () => {
    const provider = createProvider('o3-mini', { openai: 'sk-test' })
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  it('throws ProviderError when the required key is missing', () => {
    expect(() => createProvider('gpt-4o', {})).toThrow(ProviderError)
    expect(() => createProvider('claude-3-5-sonnet', {})).toThrow(ProviderError)
    expect(() => createProvider('gemini-2.5-flash', {})).toThrow(ProviderError)
  })

  it('throws ProviderError for unknown prefixes', () => {
    expect(() => createProvider('mystery-model', {
      openai: 'sk-test', anthropic: 'sk-ant-test', gemini: 'AIza-test',
    })).toThrow(ProviderError)
  })
})
