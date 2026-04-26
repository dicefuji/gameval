import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ignoredDirs = new Set(['.git', 'node_modules']);
const jsFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && full.endsWith('.js')) {
      jsFiles.push(full);
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

walk(root);

for (const file of jsFiles.sort()) {
  run(process.execPath, ['--check', file]);
}

const sample = JSON.parse(readFileSync(join(root, 'sample-eval-results.json'), 'utf8'));
if (!sample.schemaVersion || !sample.evalVersion || !sample.protocol || !sample.models) {
  throw new Error('sample-eval-results.json is missing required top-level metadata');
}

const modelCount = Object.keys(sample.models).length;
if (modelCount === 0) {
  throw new Error('sample-eval-results.json must include at least one model');
}

console.log(`Checked ${jsFiles.length} JavaScript files and sample-eval-results.json (${modelCount} models).`);
