#!/usr/bin/env node
import { runCli } from '../dist/cli/index.js'

runCli(process.argv)
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
