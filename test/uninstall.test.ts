import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveBashExecutable } from '../scripts/bun-exec';

const ROOT = path.resolve(import.meta.dir, '..');
const UNINSTALL = path.join(ROOT, 'bin', 'gstack-uninstall');
const BASH = resolveBashExecutable();
const BASH_RUNTIME_OK = (() => {
  const result = spawnSync(BASH, ['-lc', 'echo ok'], { stdio: 'pipe', env: process.env });
  return result.status === 0;
})();
const CAN_CREATE_SYMLINKS = (() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-symlink-test-'));
  try {
    const targetDir = path.join(tmpDir, 'target');
    const linkDir = path.join(tmpDir, 'link');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.symlinkSync(targetDir, linkDir, 'junction');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

describe('gstack-uninstall', () => {
  test('syntax check passes', () => {
    if (!BASH_RUNTIME_OK) return;
    const result = spawnSync(BASH, ['-n', UNINSTALL], { stdio: 'pipe', env: process.env });
    expect(result.status).toBe(0);
  });

  test('--help prints usage and exits 0', () => {
    if (!BASH_RUNTIME_OK) return;
    const result = spawnSync(BASH, [UNINSTALL, '--help'], { stdio: 'pipe', env: process.env });
    expect(result.status).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain('gstack-uninstall');
    expect(output).toContain('--force');
    expect(output).toContain('--keep-state');
  });

  test('unknown flag exits with error', () => {
    if (!BASH_RUNTIME_OK) return;
    const result = spawnSync(BASH, [UNINSTALL, '--bogus'], {
      stdio: 'pipe',
      env: { ...process.env, HOME: '/nonexistent' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain('Unknown option');
  });

  describe('integration tests with mock layout', () => {
    let tmpDir: string;
    let mockHome: string;
    let mockGitRoot: string;

    beforeEach(() => {
      if (!BASH_RUNTIME_OK || !CAN_CREATE_SYMLINKS) return;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-uninstall-test-'));
      mockHome = path.join(tmpDir, 'home');
      mockGitRoot = path.join(tmpDir, 'repo');

      // Create mock gstack install layout
      fs.mkdirSync(path.join(mockHome, '.claude', 'skills', 'gstack'), { recursive: true });
      fs.mkdirSync(path.join(mockHome, '.claude', 'skills', 'gstack', 'review'), { recursive: true });
      fs.mkdirSync(path.join(mockHome, '.claude', 'skills', 'gstack', 'ship'), { recursive: true });
      fs.writeFileSync(path.join(mockHome, '.claude', 'skills', 'gstack', 'SKILL.md'), 'test');

      // Create per-skill symlinks (both old unprefixed and new prefixed)
      fs.symlinkSync(path.join(mockHome, '.claude', 'skills', 'gstack', 'review'), path.join(mockHome, '.claude', 'skills', 'review'), 'junction');
      fs.symlinkSync(path.join(mockHome, '.claude', 'skills', 'gstack', 'ship'), path.join(mockHome, '.claude', 'skills', 'gstack-ship'), 'junction');

      // Create a non-gstack symlink (should NOT be removed)
      fs.mkdirSync(path.join(mockHome, '.claude', 'skills', 'other-tool'), { recursive: true });

      // Create state directory
      fs.mkdirSync(path.join(mockHome, '.gstack', 'projects'), { recursive: true });
      fs.writeFileSync(path.join(mockHome, '.gstack', 'config.json'), '{}');

      // Create mock git repo
      fs.mkdirSync(mockGitRoot, { recursive: true });
      spawnSync('git', ['init', '-b', 'main'], { cwd: mockGitRoot, stdio: 'pipe' });
    });

    afterEach(() => {
      if (!tmpDir) return;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('--force removes global Claude skills and state', () => {
      if (!BASH_RUNTIME_OK || !CAN_CREATE_SYMLINKS) return;
      const result = spawnSync(BASH, [UNINSTALL, '--force'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          HOME: mockHome,
          GSTACK_DIR: path.join(mockHome, '.claude', 'skills', 'gstack'),
          GSTACK_STATE_DIR: path.join(mockHome, '.gstack'),
        },
        cwd: mockGitRoot,
      });

      expect(result.status).toBe(0);
      const output = result.stdout.toString();
      expect(output).toContain('gstack uninstalled');

      // Global skill dir should be removed
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'gstack'))).toBe(false);

      // Per-skill symlinks pointing into gstack/ should be removed
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'review'))).toBe(false);
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'gstack-ship'))).toBe(false);

      // Non-gstack tool should still exist
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'other-tool'))).toBe(true);

      // State should be removed
      expect(fs.existsSync(path.join(mockHome, '.gstack'))).toBe(false);
    });

    test('--keep-state preserves state directory', () => {
      if (!BASH_RUNTIME_OK || !CAN_CREATE_SYMLINKS) return;
      const result = spawnSync(BASH, [UNINSTALL, '--force', '--keep-state'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          HOME: mockHome,
          GSTACK_DIR: path.join(mockHome, '.claude', 'skills', 'gstack'),
          GSTACK_STATE_DIR: path.join(mockHome, '.gstack'),
        },
        cwd: mockGitRoot,
      });

      expect(result.status).toBe(0);

      // Skills should be removed
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'gstack'))).toBe(false);

      // State should still exist
      expect(fs.existsSync(path.join(mockHome, '.gstack'))).toBe(true);
      expect(fs.existsSync(path.join(mockHome, '.gstack', 'config.json'))).toBe(true);
    });

    test('clean system outputs nothing to remove', () => {
      if (!BASH_RUNTIME_OK || !CAN_CREATE_SYMLINKS) return;
      const cleanHome = path.join(tmpDir, 'clean-home');
      fs.mkdirSync(cleanHome, { recursive: true });

      const result = spawnSync(BASH, [UNINSTALL, '--force'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          HOME: cleanHome,
          GSTACK_DIR: path.join(cleanHome, 'nonexistent'),
          GSTACK_STATE_DIR: path.join(cleanHome, '.gstack'),
        },
        cwd: mockGitRoot,
      });

      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toContain('Nothing to remove');
    });

    test('upgrade path: prefixed install + uninstall cleans both old and new symlinks', () => {
      if (!BASH_RUNTIME_OK || !CAN_CREATE_SYMLINKS) return;
      // Simulate the state after setup --no-prefix followed by setup (with prefix):
      // Both old unprefixed and new prefixed symlinks exist
      // (mockHome already has both 'review' and 'gstack-ship' symlinks)

      const result = spawnSync(BASH, [UNINSTALL, '--force'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          HOME: mockHome,
          GSTACK_DIR: path.join(mockHome, '.claude', 'skills', 'gstack'),
          GSTACK_STATE_DIR: path.join(mockHome, '.gstack'),
        },
        cwd: mockGitRoot,
      });

      expect(result.status).toBe(0);

      // Both old (review) and new (gstack-ship) symlinks should be gone
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'review'))).toBe(false);
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'gstack-ship'))).toBe(false);

      // Non-gstack should survive
      expect(fs.existsSync(path.join(mockHome, '.claude', 'skills', 'other-tool'))).toBe(true);
    });
  });
});
