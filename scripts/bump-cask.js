#!/usr/bin/env node
/**
 * Point the Homebrew cask at a published release.
 *
 *   node scripts/bump-cask.js 3.3.5
 *
 * The `.sha256` assets are the source of truth: they are produced by the release
 * workflow from the files it just built, so reading them here means the cask can
 * never disagree with what GitHub actually serves.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CASK = path.join(ROOT, 'Casks', 'buffy.rb');
const REPO = 'slayyyyer/buffy';

/** Pure so the rewrite can be tested without touching the network or the file. */
export function updateCask(text, { version, arm, intel }) {
  if (!/^\s*version\s+"[^"]+"/m.test(text)) throw new Error('Casks/buffy.rb has no version stanza');
  if (!/sha256\s+arm:\s+"[0-9a-f]{64}"/.test(text)) throw new Error('Casks/buffy.rb has no arm sha256');
  if (!/intel:\s+"[0-9a-f]{64}"/.test(text)) throw new Error('Casks/buffy.rb has no intel sha256');

  return text
    .replace(/^(\s*version\s+)"[^"]+"/m, `$1"${version}"`)
    .replace(/(sha256\s+arm:\s+)"[0-9a-f]{64}"/, `$1"${arm}"`)
    .replace(/(intel:\s+)"[0-9a-f]{64}"/, `$1"${intel}"`);
}

export async function publishedHash(version, slug, fetchImpl = globalThis.fetch) {
  const url = `https://github.com/${REPO}/releases/download/v${version}/Buffy-${version}-${slug}.dmg.sha256`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const text = await response.text();
  const hash = (text.match(/[0-9a-f]{64}/i) || [])[0];
  if (!hash) throw new Error(`${url} did not contain a sha256`);
  return hash.toLowerCase();
}

async function main() {
  const version = (process.argv[2] || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a release version: ${version}`);

  const arm = await publishedHash(version, 'mac-arm64');
  const intel = await publishedHash(version, 'mac-x64');

  const before = fs.readFileSync(CASK, 'utf8');
  const after = updateCask(before, { version, arm, intel });
  if (after === before) {
    console.log(`Casks/buffy.rb already points at ${version}`);
    return;
  }
  fs.writeFileSync(CASK, after);
  console.log(`Casks/buffy.rb -> ${version}`);
  console.log(`  arm   ${arm}`);
  console.log(`  intel ${intel}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  main().catch((error) => {
    console.error(`bump-cask: ${error.message}`);
    process.exit(1);
  });
}
