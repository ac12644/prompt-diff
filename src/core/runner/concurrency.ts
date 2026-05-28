import pLimit from 'p-limit'

/** Run `tasks` concurrently with at most `limit` in flight. Resolves to the array of results in input order. */
export function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const schedule = pLimit(limit)
  return Promise.all(tasks.map(task => schedule(task)))
}
