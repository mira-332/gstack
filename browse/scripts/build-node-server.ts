#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBunInvocation } from '../../scripts/bun-exec';

const ROOT = path.resolve(import.meta.dir, '../..');
const SRC_DIR = path.join(ROOT, 'browse', 'src');
const DIST_DIR = path.join(ROOT, 'browse', 'dist');
const SERVER_BUNDLE = path.join(DIST_DIR, 'server-node.mjs');

function runBun(args: string[]): void {
  const bun = resolveBunInvocation(args);
  const result = spawnSync(bun.command, bun.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`bun ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}

export function buildNodeServerBundle(): void {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  console.log('Building Node-compatible server bundle...');
  runBun([
    'build',
    path.join(SRC_DIR, 'server.ts'),
    '--target=node',
    '--outfile',
    SERVER_BUNDLE,
    '--external',
    'playwright',
    '--external',
    'playwright-core',
    '--external',
    'diff',
    '--external',
    'bun:sqlite',
  ]);

  const transpiled = fs.readFileSync(SERVER_BUNDLE, 'utf-8')
    .replace(/import\.meta\.dir/g, '__browseNodeSrcDir')
    .replace(/import \{ Database \} from "bun:sqlite";/g, 'const Database = null; // bun:sqlite stubbed on Node');

  const lines = transpiled.split(/\r?\n/);
  const header = [
    lines[0] ?? '',
    '// ── Windows Node.js compatibility (auto-generated) ──',
    'import { fileURLToPath as _ftp } from "node:url";',
    'import { dirname as _dn } from "node:path";',
    'const __browseNodeSrcDir = _dn(_dn(_ftp(import.meta.url))) + "/src";',
    '{ const _r = createRequire(import.meta.url); _r("./bun-polyfill.cjs"); }',
    '// ── end compatibility ──',
    ...lines.slice(1),
  ].join('\n');

  fs.writeFileSync(SERVER_BUNDLE, header);
  fs.copyFileSync(path.join(SRC_DIR, 'bun-polyfill.cjs'), path.join(DIST_DIR, 'bun-polyfill.cjs'));

  console.log(`Node server bundle ready: ${SERVER_BUNDLE}`);
}

if (import.meta.main) {
  buildNodeServerBundle();
}
