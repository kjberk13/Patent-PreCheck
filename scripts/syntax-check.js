'use strict';

// Walks backend/ and scripts/ for .js files and runs `node --check` on each.
// Tolerant of missing directories so boot verification does not fail on a
// fresh clone before engine files exist.

const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOTS = ['backend', 'scripts'];
const IGNORED_DIRS = new Set(['node_modules', 'coverage', 'dist']);

function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return files;
    throw err;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (stat.isFile() && entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const repoRoot = path.resolve(__dirname, '..');
const targets = ROOTS.flatMap((root) => walk(path.join(repoRoot, root)));

if (targets.length === 0) {
  console.log('syntax-check: no .js files found under', ROOTS.join(', '));
  process.exit(0);
}

let failed = 0;
for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`syntax-check: ${failed} of ${targets.length} file(s) failed`);
  process.exit(1);
}

console.log(`syntax-check: OK (${targets.length} file(s))`);
