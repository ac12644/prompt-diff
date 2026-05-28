/** Logging helpers that swallow their own failures so logging never crashes the program. */

function safeWrite(stream: NodeJS.WriteStream, line: string): void {
  try {
    stream.write(`${line}\n`)
  } catch {
    // Intentional: a broken stdout/stderr must not take the program down.
  }
}

export const logger = {
  info(message: string): void {
    safeWrite(process.stdout, message)
  },
  warn(message: string): void {
    safeWrite(process.stderr, `warn: ${message}`)
  },
  error(message: string): void {
    safeWrite(process.stderr, `error: ${message}`)
  },
}
