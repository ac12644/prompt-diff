import Anthropic from '@anthropic-ai/sdk'
import type { Provider, RunResult } from '../types.js'
import { ProviderError } from '../infra/errors.js'
import { computeCost } from './cost.js'

/** Subset of the Anthropic SDK we depend on. Lets us inject a stub in tests. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: {
      model: string
      max_tokens: number
      system?: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
    }): Promise<{
      content: Array<{ type: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }>
  }
}

const DEFAULT_MAX_TOKENS = 4096

export class AnthropicProvider implements Provider {
  readonly model: string

  constructor(
    model: string,
    private readonly client: AnthropicMessagesClient,
    private readonly maxTokens: number = DEFAULT_MAX_TOKENS,
  ) {
    this.model = model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const start = Date.now()
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: prompt,
        messages: [{ role: 'user', content: input }],
      })
      const output = res.content
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('')
      const inputTokens  = res.usage?.input_tokens  ?? 0
      const outputTokens = res.usage?.output_tokens ?? 0
      return {
        testId: '',
        version: 'v1',
        output,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - start,
        costUsd: computeCost(this.model, inputTokens, outputTokens),
      }
    } catch (err) {
      throw new ProviderError(`Anthropic call failed: ${(err as Error).message}`)
    }
  }
}

/** Build an AnthropicProvider backed by the real SDK client. */
export function createAnthropicProvider(model: string, apiKey: string): AnthropicProvider {
  return new AnthropicProvider(model, new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient)
}
