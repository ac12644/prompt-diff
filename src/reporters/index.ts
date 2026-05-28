import type { Reporter } from '../types.js'
import { TerminalReporter } from './terminal.js'
import { JsonReporter } from './json.js'

export type ReporterFormat = 'terminal' | 'json'

/** Factory for the two built-in reporter formats. */
export function createReporter(format: ReporterFormat): Reporter {
  if (format === 'json') return new JsonReporter()
  return new TerminalReporter()
}
