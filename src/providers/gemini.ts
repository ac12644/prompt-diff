import { GoogleGenAI } from '@google/genai'
import type { Provider, RunResult } from '../types.js'
import { ProviderError } from '../infra/errors.js'
import { computeCost } from './cost.js'

/** Subset of the @google/genai SDK we depend on. Lets us inject a stub in tests. */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string
      contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
      config?: { systemInstruction?: string }
    }): Promise<GeminiResponse>
  }
}

export type GeminiResponse = {
  text?: string
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export class GeminiProvider implements Provider {
  readonly model: string

  constructor(model: string, private readonly client: GeminiClient) {
    this.model = model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const start = Date.now()
    try {
      const res = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: input }] }],
        config: { systemInstruction: prompt },
      })
      const output = extractText(res)
      const inputTokens  = res.usageMetadata?.promptTokenCount     ?? 0
      const outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0
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
      throw new ProviderError(`Gemini call failed: ${(err as Error).message}`)
    }
  }
}

function extractText(res: GeminiResponse): string {
  if (typeof res.text === 'string') return res.text
  const parts = res.candidates?.[0]?.content?.parts ?? []
  return parts.map(part => part.text ?? '').join('')
}

/** Build a GeminiProvider backed by the real @google/genai SDK client. */
export function createGeminiProvider(model: string, apiKey: string): GeminiProvider {
  return new GeminiProvider(model, new GoogleGenAI({ apiKey }) as unknown as GeminiClient)
}
