import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function isExecutable(candidate: string): boolean {
  if (!candidate) return false;
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function searchPath(names: string[]): string | null {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];

  for (const entry of entries) {
    for (const name of names) {
      const direct = path.join(entry, name);
      if (isExecutable(direct)) return direct;
      if (process.platform === 'win32' && path.extname(name) === '') {
        for (const ext of exts) {
          const candidate = path.join(entry, `${name}${ext.toLowerCase()}`);
          if (isExecutable(candidate)) return candidate;
          const upperCandidate = path.join(entry, `${name}${ext.toUpperCase()}`);
          if (isExecutable(upperCandidate)) return upperCandidate;
        }
      }
    }
  }

  return null;
}

function looksLikeBunExecutable(candidate: string): boolean {
  const base = path.basename(candidate).toLowerCase();
  return base === 'bun' || base === 'bun.exe';
}

/**
 * Resolve the Bun executable without depending on PATH.
 */
export function resolveBunExecutable(): string {
  const envCandidates = [
    process.env.GSTACK_BUN_BIN,
    process.env.BUN_BIN,
    process.env.BUN_PATH,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  const home = os.homedir();
  const platformCandidates = process.platform === 'win32'
    ? [path.join(home, '.bun', 'bin', 'bun.exe')]
    : [path.join(home, '.bun', 'bin', 'bun')];

  const runtimeCandidates = [process.execPath, process.argv[0]].filter(looksLikeBunExecutable);
  const pathCandidate = searchPath(process.platform === 'win32' ? ['bun.exe', 'bun'] : ['bun']);
  const candidates = [...runtimeCandidates, ...(pathCandidate ? [pathCandidate] : []), ...platformCandidates];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

export interface ResolvedInvocation {
  command: string;
  args: string[];
}

/**
 * Resolve a Bun invocation without assuming `bun` is on PATH.
 */
export function resolveBunInvocation(args: string[]): ResolvedInvocation {
  return {
    command: resolveBunExecutable(),
    args,
  };
}

export function resolveBashExecutable(): string {
  const envCandidates = [
    process.env.GSTACK_BASH_BIN,
    process.env.BASH_BIN,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  const pathCandidate = searchPath(process.platform === 'win32' ? ['bash.exe', 'bash'] : ['bash']);
  if (pathCandidate) return pathCandidate;

  const home = os.homedir();
  const platformCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
        path.join(home, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
      ]
    : ['/bin/bash', '/usr/bin/bash'];

  for (const candidate of platformCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'bash.exe' : 'bash';
}

export function resolveBashInvocation(args: string[]): ResolvedInvocation {
  return {
    command: resolveBashExecutable(),
    args,
  };
}

export function resolveGitExecutable(): string {
  const envCandidates = [
    process.env.GSTACK_GIT_BIN,
    process.env.GIT_BIN,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  const pathCandidate = searchPath(process.platform === 'win32' ? ['git.exe', 'git'] : ['git']);
  if (pathCandidate) return pathCandidate;

  const home = os.homedir();
  const platformCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files\\Git\\bin\\git.exe',
        path.join(home, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
      ]
    : ['/usr/bin/git', '/bin/git'];

  for (const candidate of platformCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'git.exe' : 'git';
}

export function resolveNodeExecutable(): string {
  const envCandidates = [
    process.env.GSTACK_NODE_BIN,
    process.env.NODE_BIN,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  const pathCandidate = searchPath(process.platform === 'win32' ? ['node.exe', 'node'] : ['node']);
  if (pathCandidate) return pathCandidate;

  const platformCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\nodejs\\node.exe',
      ]
    : ['/usr/bin/node', '/bin/node'];

  for (const candidate of platformCandidates) {
    if (isExecutable(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'node.exe' : 'node';
}
