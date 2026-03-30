import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BrowseRuntimeTrustPin {
  schemaVersion: 1;
  generatedAt: string;
  runtimeRoot: string;
  binaryVersion?: string;
  files: Record<string, string>;
}

const DEFAULT_TRUST_FILE_NAME = 'gstack-browse-runtime.json';
const RUNTIME_FILE_CANDIDATES = [
  'browse.exe',
  'browse',
  'find-browse.exe',
  'find-browse',
  'server-node.mjs',
  'bun-polyfill.cjs',
  '.version',
];

function canonicalPath(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

export function resolveDefaultTrustFile(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.gstack', 'trust', DEFAULT_TRUST_FILE_NAME);
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function collectRuntimeFiles(runtimeDir: string): string[] {
  const root = canonicalPath(runtimeDir);
  return RUNTIME_FILE_CANDIDATES.filter((name) => fs.existsSync(path.join(root, name)));
}

export function buildRuntimeTrustPin(runtimeDir: string): BrowseRuntimeTrustPin {
  const runtimeRoot = canonicalPath(runtimeDir);
  const fileNames = collectRuntimeFiles(runtimeRoot);
  if (fileNames.length === 0) {
    throw new Error(`No runtime files found under ${runtimeRoot}`);
  }

  const files: Record<string, string> = {};
  for (const name of fileNames) {
    files[name] = sha256File(path.join(runtimeRoot, name));
  }

  let binaryVersion: string | undefined;
  try {
    binaryVersion = fs.readFileSync(path.join(runtimeRoot, '.version'), 'utf-8').trim() || undefined;
  } catch {
    binaryVersion = undefined;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtimeRoot,
    binaryVersion,
    files,
  };
}

export function writeRuntimeTrustPin(
  runtimeDir: string,
  outputPath: string = resolveDefaultTrustFile(),
): BrowseRuntimeTrustPin {
  const pin = buildRuntimeTrustPin(runtimeDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(pin, null, 2));
  return pin;
}

function parseTrustPin(trustFile: string): BrowseRuntimeTrustPin {
  if (!fs.existsSync(trustFile)) {
    throw new Error(`Runtime trust pin missing at ${trustFile}. Re-run ./setup --host codex for this checkout.`);
  }

  const raw = JSON.parse(fs.readFileSync(trustFile, 'utf-8')) as Partial<BrowseRuntimeTrustPin>;
  if (raw.schemaVersion !== 1 || typeof raw.runtimeRoot !== 'string' || !raw.files || typeof raw.files !== 'object') {
    throw new Error(`Runtime trust pin at ${trustFile} is invalid. Re-run ./setup --host codex.`);
  }

  return raw as BrowseRuntimeTrustPin;
}

export function verifyRuntimeTrust(
  runtimeDir: string,
  trustFile: string = resolveDefaultTrustFile(),
  options: { requiredFiles?: string[] } = {},
): BrowseRuntimeTrustPin {
  const pin = parseTrustPin(trustFile);
  const runtimeRoot = canonicalPath(runtimeDir);
  const pinnedRoot = canonicalPath(pin.runtimeRoot);

  if (runtimeRoot !== pinnedRoot) {
    throw new Error(
      `Runtime trust pin targets ${pinnedRoot}, but current runtime is ${runtimeRoot}. Re-run ./setup --host codex to trust this checkout.`,
    );
  }

  const requiredFiles = options.requiredFiles || [];
  const namesToVerify = new Set([...Object.keys(pin.files), ...requiredFiles]);
  for (const fileName of namesToVerify) {
    const expected = pin.files[fileName];
    if (!expected) {
      throw new Error(`Runtime trust pin does not cover ${fileName}. Re-run ./setup --host codex.`);
    }

    const target = path.join(runtimeRoot, fileName);
    if (!fs.existsSync(target)) {
      throw new Error(`Pinned runtime file missing: ${target}`);
    }

    const actual = sha256File(target);
    if (actual !== expected) {
      throw new Error(`Runtime trust mismatch for ${fileName}. Re-run ./setup --host codex if this checkout is expected.`);
    }
  }

  return pin;
}
