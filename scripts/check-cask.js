#!/usr/bin/env node
/**
 * Keep the Homebrew cask honest.
 *
 * The cask is maintained by hand and only exercised when somebody taps it, so a
 * stale version or a truncated hash can sit there unnoticed. This checks it
 * against `package.json`.
 *
 * A release is tagged before its artifacts exist, so the cask legitimately points
 * at the previous version for the few minutes the workflow is building. Being
 * behind is only tolerated while the new assets are missing: once a release's
 * checksums are published, the cask has to follow them.
 *
 *   node scripts/check-cask.js
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'slayyyyer/buffy';

export function inspectCask(text, name = 'Casks/buffy.rb') {
  const problems = [];
  const declared = (text.match(/^\s*version\s+"([^"]+)"/m) || [])[1] || null;

  // Stanzas are grouped by blank lines, so the checksum group runs from `sha256`
  // to the next blank line. That covers `sha256 "…"` and the arch-split form
  // `sha256 arm: "…", intel: "…"`.
  const shaIndex = text.search(/^[ \t]*sha256\b/m);
  let checksums = '';
  if (shaIndex >= 0) {
    const stanza = text.slice(shaIndex);
    const groupEnd = stanza.search(/\n[ \t]*\n/);
    checksums = groupEnd >= 0 ? stanza.slice(0, groupEnd) : stanza;
  }
  const hashes = [...checksums.matchAll(/"([0-9a-fA-F]{64})"/g)].map((match) => match[1]);
  if (hashes.length < 2) problems.push(`${name} should carry one sha256 per architecture`);
  for (const hash of hashes) {
    if (!/^[0-9a-f]{64}$/i.test(hash)) problems.push(`${name} has a malformed sha256: ${hash.slice(0, 12)}…`);
  }

  for (const match of text.matchAll(/url\s+"([^"]+)"/g)) {
    // The cask should interpolate the version so a bump touches one line.
    if (!match[1].includes('#{version}')) {
      problems.push(`${name} url does not interpolate the version: ${match[1]}`);
    }
  }
  if (!/^\s*app\s+"/m.test(text)) problems.push(`${name} has no app stanza`);

  return { declared, problems, hashes };
}

export async function releasePublished(version, fetchImpl = globalThis.fetch) {
  const url = `https://github.com/${REPO}/releases/download/v${version}/Buffy-${version}-mac-arm64.dmg.sha256`;
  try {
    const response = await fetchImpl(url, { method: 'HEAD' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export async function checkCask({ repoRoot = path.resolve(import.meta.dirname, '..'), version, fetchImpl } = {}) {
  const caskDir = path.join(repoRoot, 'Casks');
  const casks = fs.existsSync(caskDir) ? fs.readdirSync(caskDir).filter((entry) => entry.endsWith('.rb')) : [];
  const problems = [];
  const notes = [];
  if (!casks.length) problems.push('no cask in Casks/');

  for (const entry of casks) {
    const text = fs.readFileSync(path.join(caskDir, entry), 'utf8');
    const result = inspectCask(text, `Casks/${entry}`);
    problems.push(...result.problems);
    if (result.declared !== version) {
      const published = await releasePublished(version, fetchImpl);
      if (published) {
        problems.push(`Casks/${entry} pins ${result.declared || '(none)'}, but ${version} is published`);
      } else {
        notes.push(`VERSION_LAG Casks/${entry} pins ${result.declared}; ${version} has no published assets yet`);
      }
    }
  }

  return { problems, notes, casks };
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..'), 'package.json'), 'utf8'))
    .version;
  const { problems, notes, casks } = await checkCask({ version });
  for (const note of notes) console.log(`cask: ${note.slice('VERSION_LAG '.length)}`);
  if (problems.length) {
    for (const problem of problems) console.error(`cask: ${problem}`);
    process.exit(1);
  }
  const plural = casks.length === 1 ? 'cask' : 'casks';
  if (notes.length) {
    console.log(`cask: ${casks.length} ${plural} checked, behind ${version} until its assets publish`);
  } else {
    console.log(`cask: ${casks.length} ${plural} ${casks.length === 1 ? 'matches' : 'match'} ${version}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  main().catch((error) => {
    console.error(`cask: ${error.message}`);
    process.exit(1);
  });
}
