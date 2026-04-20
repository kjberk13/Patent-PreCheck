'use strict';

// Runs every *.test.js file under backend/__tests__ and netlify/__tests__
// (at any depth) via node --test. Replaces the shell-glob-based npm
// script, which only matched one nesting level and silently skipped
// tests in deeper __tests__ directories.

const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOTS = ['backend', 'netlify'];
const IGNORED_DIRS = new Set(['node_modules', 'coverage', 'dist']);

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return acc;
    throw err;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (stat.isFile() && /\.test\.js$/.test(entry)) {
      if (full.includes(`${path.sep}__tests__${path.sep}`)) acc.push(full);
    }
  }
  return acc;
}

const repoRoot = path.resolve(__dirname, '..');
const files = ROOTS.flatMap((r) => walk(path.join(repoRoot, r)));

if (files.length === 0) {
  console.log('run-tests: no *.test.js files found');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: repoRoot,
});
process.exit(result.status ?? 1);
