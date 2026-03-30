import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hydrateServerState } from '../src/cli';
import { treatStopDisconnectAsSuccess } from '../src/cli';
import {
  resolveDefaultTrustFile,
  verifyRuntimeTrust,
  writeRuntimeTrustPin,
} from '../src/runtime-trust';

function makeRuntimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-runtime-trust-'));
  fs.writeFileSync(path.join(root, 'browse.exe'), 'browse-binary');
  fs.writeFileSync(path.join(root, 'server-node.mjs'), 'export default "server";\n');
  fs.writeFileSync(path.join(root, 'bun-polyfill.cjs'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, '.version'), 'abc123\n');
  return root;
}

describe('runtime trust', () => {
  test('resolveDefaultTrustFile uses the provided home directory', () => {
    const homeDir = path.join(os.tmpdir(), 'browse-runtime-home');
    expect(resolveDefaultTrustFile(homeDir)).toBe(path.join(homeDir, '.gstack', 'trust', 'gstack-browse-runtime.json'));
  });

  test('verifyRuntimeTrust accepts a pinned runtime', () => {
    const runtimeRoot = makeRuntimeFixture();
    const trustFile = path.join(runtimeRoot, 'pins', 'runtime.json');

    try {
      writeRuntimeTrustPin(runtimeRoot, trustFile);
      expect(() => verifyRuntimeTrust(runtimeRoot, trustFile, {
        requiredFiles: ['browse.exe', 'server-node.mjs', 'bun-polyfill.cjs', '.version'],
      })).not.toThrow();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test('verifyRuntimeTrust rejects tampered runtime files', () => {
    const runtimeRoot = makeRuntimeFixture();
    const trustFile = path.join(runtimeRoot, 'pins', 'runtime.json');

    try {
      writeRuntimeTrustPin(runtimeRoot, trustFile);
      fs.writeFileSync(path.join(runtimeRoot, 'server-node.mjs'), 'export default "tampered";\n');

      expect(() => verifyRuntimeTrust(runtimeRoot, trustFile, {
        requiredFiles: ['browse.exe', 'server-node.mjs', 'bun-polyfill.cjs', '.version'],
      })).toThrow('Runtime trust mismatch');
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});

describe('CLI secret-state integration', () => {
  test('CLI hydrates auth token from the user-scoped secret state file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-cli-secret-state-'));
    const secretFile = path.join(tmpDir, 'user-state', 'browse-auth.json');
    const token = 'secret-token-from-auth-state';

    fs.mkdirSync(path.dirname(secretFile), { recursive: true });

    fs.writeFileSync(secretFile, JSON.stringify({
      token,
      createdAt: new Date().toISOString(),
    }, null, 2));
    const hydrated = hydrateServerState({
      pid: process.pid,
      port: 43123,
      startedAt: new Date().toISOString(),
      serverPath: 'test-server',
      secretStateFile: secretFile,
    }, secretFile);

    fs.rmSync(tmpDir, { recursive: true, force: true });

    expect(hydrated).not.toBeNull();
    expect(hydrated?.token).toBe(token);
    expect(hydrated?.secretStateFile).toBe(secretFile);
  });

  test('stop disconnects are treated as success after shutdown completes', async () => {
    const states = [
      {
        pid: process.pid,
        port: 43123,
        startedAt: new Date().toISOString(),
        serverPath: 'test-server',
        token: 'token',
      },
      null,
    ];

    let healthChecks = 0;
    const result = await treatStopDisconnectAsSuccess(
      'stop',
      () => states.shift() ?? null,
      async () => {
        healthChecks += 1;
        return healthChecks === 1;
      },
      500,
    );

    expect(result).toBe(true);
    expect(healthChecks).toBeGreaterThanOrEqual(1);
  });
});
