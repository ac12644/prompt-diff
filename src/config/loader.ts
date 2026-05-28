import { readFile } from 'node:fs/promises'
import { load as parseYaml } from 'js-yaml'
import { ZodError } from 'zod'
import { ConfigSchema } from './schema.js'
import { ConfigError } from '../infra/errors.js'
import type { Config } from '../types.js'

/** Read a YAML test suite from disk, parse, validate, and return a typed Config. */
export async function loadConfig(path: string): Promise<Config> {
  const raw = await readSuiteFile(path)
  const parsed = parseSuiteYaml(raw, path)
  return validateSuite(parsed, path)
}

async function readSuiteFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    throw new ConfigError(`Could not read suite file at ${path}: ${(err as Error).message}`)
  }
}

function parseSuiteYaml(raw: string, path: string): unknown {
  try {
    return parseYaml(raw)
  } catch (err) {
    throw new ConfigError(`Invalid YAML in ${path}: ${(err as Error).message}`)
  }
}

function validateSuite(parsed: unknown, path: string): Config {
  try {
    return ConfigSchema.parse(parsed)
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigError(`Invalid suite in ${path}:\n${formatZodError(err)}`)
    }
    throw err
  }
}

function formatZodError(err: ZodError): string {
  return err.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

/** Read a prompt file from disk. Throws ConfigError on missing/unreadable file. */
export async function readPromptFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    throw new ConfigError(`Could not read prompt file at ${path}: ${(err as Error).message}`)
  }
}
