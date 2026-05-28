import { ConfigError, ProviderError } from '../infra/errors.js'
import { orchestrate, type ProviderFactory, type OrchestrateInternals } from '../orchestrate.js'
import { orchestrateSuggest, type SuggestInternals } from '../suggest.js'
import { loadDotenv } from '../infra/dotenv.js'
import { buildProgram, type ParsedCli, type ParsedDiff, type ParsedSuggest } from './args.js'
import { renderSuggestTerminal, renderSuggestJson } from '../reporters/suggest.js'
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
  stdout?: { write: (chunk: string) => void }
}

/** Run the CLI with the given argv. Returns the process exit code. */
export async function runCli(argv: string[], cli: CliEnv = {}): Promise<number> {
  const env: Record<string, string | undefined> = { ...(cli.env ?? process.env) }
  const stderr = cli.stderr ?? process.stderr
  const stdout = cli.stdout ?? process.stdout

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
    if (parsed.kind === 'diff') return await runDiff(parsed, env, cli.providerFactory)
    return await runSuggest(parsed, env, cli.providerFactory, stdout)
  } catch (err) {
    return handleError(err, stderr)
  }
}

async function runDiff(
  parsed: ParsedDiff,
  env: Record<string, string | undefined>,
  providerFactory: ProviderFactory | undefined,
): Promise<number> {
  const report = await orchestrate(
    parsed.v1Path, parsed.v2Path, parsed.options.suite,
    buildDiffOptions(parsed, env, providerFactory),
  )
  const minScore = parsed.options.minScore
  if (minScore !== undefined && report.regressionScore < minScore) return EXIT_REGRESSION
  return EXIT_OK
}

async function runSuggest(
  parsed: ParsedSuggest,
  env: Record<string, string | undefined>,
  providerFactory: ProviderFactory | undefined,
  stdout: { write: (chunk: string) => void },
): Promise<number> {
  const report = await orchestrateSuggest(
    parsed.promptPath, parsed.options.suite,
    buildSuggestOptions(parsed, env, providerFactory),
  )
  const out = parsed.options.format === 'json'
    ? renderSuggestJson(report, parsed.promptPath)
    : renderSuggestTerminal(report, parsed.promptPath)
  stdout.write(out + '\n')
  return report.accepted ? EXIT_OK : EXIT_REGRESSION
}

function buildDiffOptions(
  parsed: ParsedDiff,
  env: Record<string, string | undefined>,
  providerFactory: ProviderFactory | undefined,
): OrchestrateInternals {
  const options: OrchestrateInternals = {
    apiKeys: readApiKeys(env),
    noCache: parsed.options.cache === false,
    format: parsed.options.format,
  }
  if (parsed.options.model !== undefined) options.model = parsed.options.model
  if (env.PROMPTDIFF_CACHE_DIR)           options.cacheDir = env.PROMPTDIFF_CACHE_DIR
  if (providerFactory)                    options.providerFactory = providerFactory
  return options
}

function buildSuggestOptions(
  parsed: ParsedSuggest,
  env: Record<string, string | undefined>,
  providerFactory: ProviderFactory | undefined,
): SuggestInternals {
  const options: SuggestInternals = {
    apiKeys: readApiKeys(env),
    noCache: parsed.options.cache === false,
    format: parsed.options.format,
  }
  if (parsed.options.suggester      !== undefined) options.suggesterModel = parsed.options.suggester
  if (parsed.options.output         !== undefined) options.outputPath = parsed.options.output
  if (parsed.options.minImprovement !== undefined) options.minImprovement = parsed.options.minImprovement
  if (env.PROMPTDIFF_CACHE_DIR)                    options.cacheDir = env.PROMPTDIFF_CACHE_DIR
  if (providerFactory)                             options.providerFactory = providerFactory
  return options
}

function readApiKeys(env: Record<string, string | undefined>): ProviderKeys {
  const keys: ProviderKeys = {}
  if (env.OPENAI_API_KEY)    keys.openai    = env.OPENAI_API_KEY
  if (env.ANTHROPIC_API_KEY) keys.anthropic = env.ANTHROPIC_API_KEY
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
  if (geminiKey)             keys.gemini    = geminiKey
  return keys
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
