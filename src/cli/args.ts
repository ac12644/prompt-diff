import { Command } from 'commander'

export type CliOptions = {
  suite: string
  model?: string
  minScore?: number
  cache: boolean              // commander stores --no-cache as `cache: false`
  format: 'terminal' | 'json'
}

export type SuggestCliOptions = {
  suite: string
  suggester?: string
  output?: string
  minImprovement?: number
  cache: boolean
  format: 'terminal' | 'json'
}

export type ParsedDiff = { kind: 'diff'; v1Path: string; v2Path: string; options: CliOptions }
export type ParsedSuggest = { kind: 'suggest'; promptPath: string; options: SuggestCliOptions }
export type ParsedCli = ParsedDiff | ParsedSuggest

/**
 * Build the commander program. Calls `onAction` with the matched subcommand
 * and parsed args. The default (no subcommand) is the diff workflow.
 */
export function buildProgram(onAction: (parsed: ParsedCli) => void): Command {
  const program = new Command()
    .name('promptdiff')
    .description('Behavioral regression testing for LLM prompts.')
    .version('0.1.0')

  // Default subcommand: diff (preserves the original `promptdiff v1 v2 -s suite.yaml` UX).
  program
    .command('diff', { isDefault: true })
    .description('Compare two prompt versions against a test suite.')
    .argument('<v1>', 'Path to baseline prompt file')
    .argument('<v2>', 'Path to candidate prompt file')
    .requiredOption('-s, --suite <path>', 'Path to test suite YAML')
    .option('-m, --model <name>', 'Override model from suite')
    .option('--min-score <n>', 'Exit 1 if regression score is below this (0–100)', parseIntFlag)
    .option('--no-cache', 'Skip the response cache; always call the provider')
    .option('--format <type>', 'Output format: terminal | json', 'terminal')
    .action((v1: string, v2: string, opts: CliOptions) => {
      onAction({ kind: 'diff', v1Path: v1, v2Path: v2, options: opts })
    })

  // suggest: take a single prompt + suite, ask an LLM to rewrite, auto-verify.
  program
    .command('suggest')
    .description('Ask an LLM for an improved prompt and auto-verify it against the suite.')
    .argument('<prompt>', 'Path to the prompt to improve')
    .requiredOption('-s, --suite <path>', 'Path to test suite YAML')
    .option('--suggester <model>', 'Model used to rewrite the prompt (default: claude-opus-4-7)')
    .option('-o, --output <path>', 'Write the suggested prompt to this file')
    .option('--min-improvement <n>', 'Reject suggestion if score below this (default: 90)', parseIntFlag)
    .option('--no-cache', 'Skip the response cache; always call the provider')
    .option('--format <type>', 'Output format: terminal | json', 'terminal')
    .action((prompt: string, opts: SuggestCliOptions) => {
      onAction({ kind: 'suggest', promptPath: prompt, options: opts })
    })

  program.exitOverride()
  return program
}

function parseIntFlag(value: string): number {
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) throw new Error(`expected a number, got "${value}"`)
  return n
}
