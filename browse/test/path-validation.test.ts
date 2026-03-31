import { describe, it, expect } from 'bun:test';
import { validateOutputPath } from '../src/meta-commands';
import { validateReadPath } from '../src/read-commands';
import { symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TEMP_DIR, IS_WINDOWS } from '../src/platform';

describe('validateOutputPath', () => {
  it('allows paths within temp dir', () => {
    expect(() => validateOutputPath(join(TEMP_DIR, 'screenshot.png'))).not.toThrow();
  });

  it('allows paths in subdirectories of temp dir', () => {
    expect(() => validateOutputPath(join(TEMP_DIR, 'browse', 'output.png'))).not.toThrow();
  });

  it('allows paths within cwd', () => {
    expect(() => validateOutputPath(`${process.cwd()}/output.png`)).not.toThrow();
  });

  it('blocks paths outside safe directories', () => {
    const outside = IS_WINDOWS ? 'C:\\outside\\backdoor.png' : '/etc/cron.d/backdoor.png';
    expect(() => validateOutputPath(outside)).toThrow(/Path must be within/);
  });

  it('blocks temp-dir prefix collision', () => {
    expect(() => validateOutputPath(`${TEMP_DIR}-evil/file.png`)).toThrow(/Path must be within/);
  });

  it('blocks home directory paths', () => {
    const homeLike = IS_WINDOWS ? 'C:\\Users\\someone\\file.png' : '/Users/someone/file.png';
    expect(() => validateOutputPath(homeLike)).toThrow(/Path must be within/);
  });

  it('blocks path traversal via ..', () => {
    const traversalTarget = join(TEMP_DIR, '..', 'etc', 'passwd');
    expect(() => validateOutputPath(traversalTarget)).toThrow(/Path must be within/);
  });
});

describe('validateReadPath', () => {
  it('allows absolute paths within temp dir', () => {
    expect(() => validateReadPath(join(TEMP_DIR, 'script.js'))).not.toThrow();
  });

  it('allows absolute paths within cwd', () => {
    expect(() => validateReadPath(`${process.cwd()}/test.js`)).not.toThrow();
  });

  it('allows relative paths without traversal', () => {
    expect(() => validateReadPath('src/index.js')).not.toThrow();
  });

  it('blocks absolute paths outside safe directories', () => {
    const outside = IS_WINDOWS ? 'C:\\outside\\passwd' : '/etc/passwd';
    expect(() => validateReadPath(outside)).toThrow(/Path must be within/);
  });

  it('blocks temp-dir prefix collision', () => {
    expect(() => validateReadPath(`${TEMP_DIR}-evil/file.js`)).toThrow(/Path must be within/);
  });

  it('blocks path traversal sequences', () => {
    expect(() => validateReadPath('../../../etc/passwd')).toThrow(/Path must be within/);
  });

  it('blocks nested path traversal', () => {
    expect(() => validateReadPath('src/../../etc/passwd')).toThrow(/Path must be within/);
  });

  it('blocks symlink inside safe dir pointing outside', () => {
    const linkPath = join(tmpdir(), 'test-symlink-bypass-' + Date.now());
    const targetPath = IS_WINDOWS ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
    try {
      symlinkSync(targetPath, linkPath);
      expect(() => validateReadPath(linkPath)).toThrow(/Path must be within/);
    } catch (err: any) {
      if (IS_WINDOWS && err?.code === 'EPERM') {
        return;
      }
      throw err;
    } finally {
      try { unlinkSync(linkPath); } catch {}
    }
  });

  it('throws clear error on non-ENOENT realpathSync failure', () => {
    // Attempting to resolve a path through a non-directory should throw
    // a descriptive error (ENOTDIR), not silently pass through.
    // Create a regular file, then try to resolve a path through it as if it were a directory.
    const filePath = join(tmpdir(), 'test-notdir-' + Date.now());
    try {
      writeFileSync(filePath, 'not a directory');
      // filePath is a file, so filePath + '/subpath' triggers ENOTDIR
      const invalidPath = join(filePath, 'subpath');
      if (IS_WINDOWS) {
        expect(() => validateReadPath(invalidPath)).not.toThrow();
      } else {
        expect(() => validateReadPath(invalidPath)).toThrow(/Cannot resolve real path|Path must be within/);
      }
    } finally {
      try { unlinkSync(filePath); } catch {}
    }
  });
});
