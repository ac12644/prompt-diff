#!/usr/bin/env node
// Build helper: copies src/providers/prices.json to dist/providers/prices.json so
// the compiled package can find it. tsc doesn't move non-TS files.
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', 'src', 'providers', 'prices.json')
const dst = resolve(here, '..', 'dist', 'providers', 'prices.json')

await mkdir(dirname(dst), { recursive: true })
await copyFile(src, dst)
console.log(`Copied ${src} → ${dst}`)
