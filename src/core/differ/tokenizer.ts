import { encoding_for_model, get_encoding, type Tiktoken, type TiktokenModel } from 'tiktoken'

const encoderCache = new Map<string, Tiktoken>()

function getEncoder(model: string): Tiktoken {
  const cached = encoderCache.get(model)
  if (cached) return cached

  let encoder: Tiktoken
  try {
    encoder = encoding_for_model(model as TiktokenModel)
  } catch {
    // Unknown models (e.g. Anthropic) fall back to the most common BPE table.
    // Approximate, but gives meaningful token deltas for prompt comparison.
    encoder = get_encoding('cl100k_base')
  }
  encoderCache.set(model, encoder)
  return encoder
}

/** Count BPE tokens in `text` using the encoder for `model`. */
export function countTokens(text: string, model: string): number {
  if (text === '') return 0
  return getEncoder(model).encode(text).length
}
