import { resolveDefaultTrustFile, writeRuntimeTrustPin } from '../src/runtime-trust';

function readFlag(name: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1] || null;
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return null;
}

const runtimeDir = readFlag('--runtime-dir');
const output = readFlag('--output') || resolveDefaultTrustFile();

if (!runtimeDir) {
  console.error('Usage: bun run browse/scripts/write-runtime-trust.ts --runtime-dir <dir> [--output <file>]');
  process.exit(1);
}

const pin = writeRuntimeTrustPin(runtimeDir, output);
console.log(`Pinned ${Object.keys(pin.files).length} runtime files to ${output}`);
