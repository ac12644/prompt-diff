import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Provider, RunResult } from '../types.js'
import { logger } from './logger.js'

/**
 * Decorator that caches Provider responses by sha256 of (model, prompt, input).
 * Transparent to callers — read failures fall through, write failures warn and continue.
 */
export class CachedProvider implements Provider {
  readonly model: string

  constructor(
    private readonly inner: Provider,
    private readonly dir: string = '.promptdiff-cache',
  ) {
    this.model = inner.model
  }

  async complete(prompt: string, input: string): Promise<RunResult> {
    const key = hashKey(this.model, prompt, input)
    const cached = await this.read(key)
    if (cached) return cached

    const result = await this.inner.complete(prompt, input)
    await this.write(key, result)
    return result
  }

  private async read(key: string): Promise<RunResult | null> {
    try {
      const raw = await readFile(join(this.dir, `${key}.json`), 'utf8')
      return JSON.parse(raw) as RunResult
    } catch {
      return null
    }
  }

  private async write(key: string, result: RunResult): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(join(this.dir, `${key}.json`), JSON.stringify(result, null, 2), 'utf8')
    } catch (err) {
      logger.warn(`cache write failed for ${key}: ${(err as Error).message}`)
    }
  }
}

function hashKey(model: string, prompt: string, input: string): string {
  return createHash('sha256').update(`${model}:${prompt}:${input}`).digest('hex').slice(0, 16)
}
