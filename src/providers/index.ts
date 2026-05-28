import type { Provider, ProviderKeys } from '../types.js'
import { ProviderError } from '../infra/errors.js'
import { createOpenAIProvider } from './openai.js'
import { createAnthropicProvider } from './anthropic.js'
import { createGeminiProvider } from './gemini.js'

/** Build a Provider for `model`, dispatching by model-name prefix. */
export function createProvider(model: string, keys: ProviderKeys = {}): Provider {
  if (isOpenAIModel(model)) {
    if (!keys.openai) {
      throw new ProviderError(`OPENAI_API_KEY is required for model "${model}"`)
    }
    return createOpenAIProvider(model, keys.openai)
  }
  if (isAnthropicModel(model)) {
    if (!keys.anthropic) {
      throw new ProviderError(`ANTHROPIC_API_KEY is required for model "${model}"`)
    }
    return createAnthropicProvider(model, keys.anthropic)
  }
  if (isGeminiModel(model)) {
    if (!keys.gemini) {
      throw new ProviderError(`GEMINI_API_KEY is required for model "${model}"`)
    }
    return createGeminiProvider(model, keys.gemini)
  }
  throw new ProviderError(`Unknown model "${model}". Expected a gpt-*, o1-*, o3-*, claude-*, or gemini-* prefix.`)
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-') || model.startsWith('o4-')
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-')
}

function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-')
}
