#!/usr/bin/env node
import { main } from '../src/cli.js';

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    process.stderr.write(`buffy: ${error?.stack || error?.message || error}\n`);
    process.exitCode = 1;
  });
