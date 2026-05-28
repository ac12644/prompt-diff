import { Command } from 'commander'

export type CliOptions = {
  suite: string
  model?: string
  minScore?: number
  cache: boolean              // commander stores --no-cache as `cache: false`
  format: 'terminal' | 'json'
}

export type ParsedCli = {
  v1Path: string
  v2Path: string
  options: CliOptions
}

/** Build the commander program. Calls `onAction` with parsed args when the program runs. */
export function buildProgram(onAction: (parsed: ParsedCli) => void): Command {
  const program = new Command()
    .name('promptdiff')
    .description('Compare two prompt versions behaviorally')
    .version('0.1.0')
    .argument('<v1>', 'Path to first prompt file')
    .argument('<v2>', 'Path to second prompt file')
    .requiredOption('-s, --suite <path>', 'Path to test suite YAML')
    .option('-m, --model <name>', 'Override model from suite')
    .option('--min-score <n>', 'Exit 1 if regression score is below this (0–100)', parseIntFlag)
    .option('--no-cache', 'Skip the response cache; always call the provider')
    .option('--format <type>', 'Output format: terminal | json', 'terminal')
    .action((v1: string, v2: string, opts: CliOptions) => {
      onAction({ v1Path: v1, v2Path: v2, options: opts })
    })

  program.exitOverride()
  return program
}

function parseIntFlag(value: string): number {
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) throw new Error(`expected a number, got "${value}"`)
  return n
}
