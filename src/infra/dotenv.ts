import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal `.env` loader. Parses KEY=VALUE lines, ignores blanks and `#` comments,
 * strips surrounding single/double quotes, and merges into `into` without
 * overwriting keys that are already set. Returns the number of keys added.
 *
 * Deliberately not a full dotenv reimplementation — no expansion, no multiline
 * values. Enough for `OPENAI_API_KEY=sk-...` style files, which is all we need.
 */
export function loadDotenv(
  cwd: string,
  into: Record<string, string | undefined>,
  filename = '.env',
): number {
  const path = resolve(cwd, filename)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return 0
  }

  let added = 0
  for (const line of raw.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed) continue
    if (into[parsed.key] !== undefined) continue   // existing env wins
    into[parsed.key] = parsed.value
    added++
  }
  return added
}

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null

  const eq = trimmed.indexOf('=')
  if (eq <= 0) return null

  const key = trimmed.slice(0, eq).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null

  let value = trimmed.slice(eq + 1).trim()
  // Strip an inline `# comment` only if value isn't quoted.
  if (value[0] !== '"' && value[0] !== "'") {
    const hashAt = value.indexOf(' #')
    if (hashAt >= 0) value = value.slice(0, hashAt).trim()
  }
  // Strip matching surrounding quotes.
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return { key, value }
}
