import { ConfigError, ProviderError } from '../infra/errors.js'
import { orchestrate, type ProviderFactory, type OrchestrateInternals } from '../orchestrate.js'
import { loadDotenv } from '../infra/dotenv.js'
import { buildProgram, type ParsedCli } from './args.js'
import type { ProviderKeys } from '../types.js'

export const EXIT_OK         = 0
export const EXIT_REGRESSION = 1
export const EXIT_CONFIG     = 2
export const EXIT_PROVIDER   = 3
export const EXIT_UNEXPECTED = 1

export type CliEnv = {
  env?: Record<string, string | undefined>
  providerFactory?: ProviderFactory
  stderr?: { write: (chunk: string) => void }
}

/** Run the CLI with the given argv. Returns the process exit code. */
export async function runCli(argv: string[], cli: CliEnv = {}): Promise<number> {
  // Mutable so loadDotenv can fill in missing keys. Explicit env wins over .env.
  const env: Record<string, string | undefined> = { ...(cli.env ?? process.env) }
  const stderr = cli.stderr ?? process.stderr

  loadDotenv(process.cwd(), env)

  let parsed: ParsedCli | undefined
  const program = buildProgram(p => { parsed = p })

  try {
    await program.parseAsync(argv)
  } catch (err) {
    const e = err as { code?: string; exitCode?: number; message?: string }
    if (e.exitCode === 0 || e.code === 'commander.help' || e.code === 'commander.helpDisplayed' || e.code === 'commander.version') {
      return EXIT_OK
    }
    stderr.write(`${e.message ?? String(err)}\n`)
    return EXIT_CONFIG
  }
  if (!parsed) return EXIT_OK

  try {
    const report = await orchestrate(
      parsed.v1Path,
      parsed.v2Path,
      parsed.options.suite,
      buildOrchestrateOptions(parsed, env, cli.providerFactory),
    )
    const minScore = parsed.options.minScore
    if (minScore !== undefined && report.regressionScore < minScore) return EXIT_REGRESSION
    return EXIT_OK
  } catch (err) {
    return handleError(err, stderr)
  }
}

function buildOrchestrateOptions(
  parsed: ParsedCli,
  env: Record<string, string | undefined>,
  providerFactory: ProviderFactory | undefined,
): OrchestrateInternals {
  const apiKeys: ProviderKeys = {}
  if (env.OPENAI_API_KEY)    apiKeys.openai    = env.OPENAI_API_KEY
  if (env.ANTHROPIC_API_KEY) apiKeys.anthropic = env.ANTHROPIC_API_KEY
  // Google's SDK accepts either env var name; prefer the canonical GEMINI_API_KEY.
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
  if (geminiKey)             apiKeys.gemini    = geminiKey

  const options: OrchestrateInternals = {
    apiKeys,
    noCache: parsed.options.cache === false,
    format: parsed.options.format,
  }
  if (parsed.options.model !== undefined) options.model = parsed.options.model
  if (env.PROMPTDIFF_CACHE_DIR)           options.cacheDir = env.PROMPTDIFF_CACHE_DIR
  if (providerFactory)                    options.providerFactory = providerFactory
  return options
}

function handleError(err: unknown, stderr: { write: (chunk: string) => void }): number {
  if (err instanceof ConfigError) {
    stderr.write(`Config error: ${err.message}\n`)
    return EXIT_CONFIG
  }
  if (err instanceof ProviderError) {
    stderr.write(`Provider error: ${err.message}\n`)
    return EXIT_PROVIDER
  }
  stderr.write(`Unexpected error: ${(err as Error).message ?? String(err)}\n`)
  return EXIT_UNEXPECTED
}
