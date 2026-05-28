import type { DiffReport, Reporter } from '../types.js'

/** Emits the DiffReport as pretty-printed JSON to stdout (or an injected stream). */
export class JsonReporter implements Reporter {
  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  render(report: DiffReport, v1Path: string, v2Path: string): void {
    const payload = { v1Path, v2Path, ...report }
    this.stream.write(JSON.stringify(payload, null, 2) + '\n')
  }
}
