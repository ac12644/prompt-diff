import OpenAI from 'openai'
import type { Provider, RunResult } from '../types.js'
import { ProviderError } from '../infra/errors.js'
import { computeCost } from './cost.js'

/** Subset of the OpenAI SDK we depend on. Lets us inject a stub in tests. */
export interface OpenAIChatClient {
  chat: {
    completions: {
      create(params: {
        model: string
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      }): Promise<{
        choices: Array<{ message?: { content?: string | null } | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null
      }>
    }
  }
}

export class OpenAIProvider implements Provider {
  readonly model: string

  constructor(model: string, private readonly client: OpenAIChatClient) {
    this.model = model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const start = Date.now()
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user',   content: input  },
        ],
      })
      const output = res.choices[0]?.message?.content ?? ''
      const inputTokens  = res.usage?.prompt_tokens     ?? 0
      const outputTokens = res.usage?.completion_tokens ?? 0
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
      throw new ProviderError(`OpenAI call failed: ${(err as Error).message}`)
    }
  }
}

/** Build an OpenAIProvider backed by the real SDK client. */
export function createOpenAIProvider(model: string, apiKey: string): OpenAIProvider {
  return new OpenAIProvider(model, new OpenAI({ apiKey }) as unknown as OpenAIChatClient)
}
