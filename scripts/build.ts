#!/usr/bin/env bun

import * as fs from 'fs';
import * as path from 'path';
import { buildNodeServerBundle } from '../browse/scripts/build-node-server';
import { runGenSkillDocs } from './gen-skill-docs';

const ROOT = path.resolve(import.meta.dir, '..');

async function compileBinary(entrypoint: string, outfile: string, label: string): Promise<void> {
  console.log(`Building ${label}...`);
  await Bun.build({
    entrypoints: [path.join(ROOT, entrypoint)],
    outfile: path.join(ROOT, outfile),
    compile: true,
    target: 'bun',
  });
}

function resolveGitDir(root: string): string {
  const gitPath = path.join(root, '.git');
  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }

  const pointer = fs.readFileSync(gitPath, 'utf-8').trim();
  const match = pointer.match(/^gitdir:\s*(.+)$/i);
  if (!match) {
    throw new Error(`Unsupported .git file format in ${gitPath}`);
  }

  return path.resolve(root, match[1]);
}

function resolveHeadCommit(root: string): string {
  const gitDir = resolveGitDir(root);
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
  if (!head.startsWith('ref: ')) {
    return `${head}\n`;
  }

  const ref = head.slice(5).trim();
  const refPath = path.join(gitDir, ...ref.split('/'));
  if (fs.existsSync(refPath)) {
    return `${fs.readFileSync(refPath, 'utf-8').trim()}\n`;
  }

  const packedRefsPath = path.join(gitDir, 'packed-refs');
  if (fs.existsSync(packedRefsPath)) {
    const packedRefs = fs.readFileSync(packedRefsPath, 'utf-8').split(/\r?\n/);
    for (const line of packedRefs) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const [commit, packedRef] = line.split(' ');
      if (packedRef === ref) {
        return `${commit}\n`;
      }
    }
  }

  throw new Error(`Could not resolve git ref ${ref}`);
}

const genExitCode = runGenSkillDocs({ hostArg: 'all' });
if (genExitCode !== 0) {
  process.exit(genExitCode);
}
await compileBinary('browse/src/cli.ts', 'browse/dist/browse', 'browse');
await compileBinary('browse/src/find-browse.ts', 'browse/dist/find-browse', 'find-browse');
await compileBinary('design/src/cli.ts', 'design/dist/design', 'design');
await compileBinary('bin/gstack-global-discover.ts', 'bin/gstack-global-discover', 'global discover');
await buildNodeServerBundle();

const version = resolveHeadCommit(ROOT);
fs.writeFileSync(path.join(ROOT, 'browse', 'dist', '.version'), version);
fs.writeFileSync(path.join(ROOT, 'design', 'dist', '.version'), version);

for (const file of [
  path.join(ROOT, 'browse', 'dist', 'browse'),
  path.join(ROOT, 'browse', 'dist', 'find-browse'),
  path.join(ROOT, 'design', 'dist', 'design'),
  path.join(ROOT, 'bin', 'gstack-global-discover'),
]) {
  if (fs.existsSync(file)) {
    try {
      fs.chmodSync(file, 0o755);
    } catch {
      // best effort on Windows
    }
  }
}

for (const entry of fs.readdirSync(ROOT)) {
  if (/^\..*\.bun-build$/i.test(entry)) {
    try {
      fs.unlinkSync(path.join(ROOT, entry));
    } catch {
      // best effort cleanup
    }
  }
}
