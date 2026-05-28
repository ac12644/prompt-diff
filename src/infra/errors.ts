/** Thrown when a YAML config or prompt file is malformed or missing. */
export class ConfigError extends Error {
  readonly _tag = 'ConfigError'
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Thrown when a provider API call fails after wrapping the original error. */
export class ProviderError extends Error {
  readonly _tag = 'ProviderError'
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Reserved for cache layer failures that callers may want to inspect. */
export class CacheError extends Error {
  readonly _tag = 'CacheError'
  constructor(message: string) {
    super(message)
    this.name = 'CacheError'
  }
}
