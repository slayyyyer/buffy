#!/usr/bin/env node
/**
 * Keep the Homebrew cask honest.
 *
 * The cask is maintained by hand and only exercised when somebody taps it, so a
 * stale version or a truncated hash can sit there unnoticed. This checks it
 * against `package.json` on every change.
 *
 *   node scripts/check-cask.js
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const version = JSON.parse(read('package.json')).version;
const problems = [];

const caskDir = path.join(root, 'Casks');
const casks = fs.existsSync(caskDir) ? fs.readdirSync(caskDir).filter((name) => name.endsWith('.rb')) : [];
if (!casks.length) problems.push('no cask in Casks/');

for (const name of casks) {
  const text = read(path.join('Casks', name));
  const declared = (text.match(/^\s*version\s+"([^"]+)"/m) || [])[1];
  if (declared !== version) {
    problems.push(`Casks/${name} pins version ${declared || '(none)'}, package.json is ${version}`);
  }
  const hashes = [...text.matchAll(/sha256\s+"([0-9a-fA-F]+)"/g)].map((match) => match[1]);
  if (hashes.length < 2) problems.push(`Casks/${name} should carry one sha256 per architecture`);
  for (const hash of hashes) {
    if (!/^[0-9a-f]{64}$/i.test(hash)) problems.push(`Casks/${name} has a malformed sha256: ${hash.slice(0, 12)}…`);
  }
  for (const match of text.matchAll(/url\s+"([^"]+)"/g)) {
    // The cask should interpolate the version so a bump touches one line.
    if (!match[1].includes('#{version}') && !match[1].includes(`v${version}/`)) {
      problems.push(`Casks/${name} url does not follow the version: ${match[1]}`);
    }
  }
  if (!/^\s*app\s+"/m.test(text)) problems.push(`Casks/${name} has no app stanza`);
}

if (problems.length) {
  for (const problem of problems) console.error(`cask: ${problem}`);
  process.exit(1);
}
const verb = casks.length === 1 ? 'matches' : 'match';
console.log(`cask: ${casks.length} cask${casks.length === 1 ? '' : 's'} ${verb} ${version}`);
