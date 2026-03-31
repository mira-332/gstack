import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execBashScript } from './helpers/shell';

const ROOT = path.resolve(import.meta.dir, '..');
const BIN = path.join(ROOT, 'bin');
const REVIEW_LOG_SCRIPT = path.join(BIN, 'gstack-review-log');
const describeShell = process.platform === 'win32' && process.env.GSTACK_RUN_SHELL_TESTS !== '1'
  ? describe.skip
  : describe;

let tmpDir: string;
let slugDir: string;

function run(input: string, opts: { expectFail?: boolean } = {}): { stdout: string; exitCode: number } {
  const execOpts = {
    cwd: ROOT,
    env: { ...process.env, GSTACK_HOME: tmpDir },
    timeout: 10000,
  };
  try {
    const stdout = execBashScript(REVIEW_LOG_SCRIPT, [input], execOpts);
    return { stdout, exitCode: 0 };
  } catch (e: any) {
    if (opts.expectFail) {
      return { stdout: e.stderr?.toString() || '', exitCode: e.status || 1 };
    }
    throw e;
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-revlog-'));
  // gstack-review-log uses gstack-slug which needs a git repo — create the projects dir
  // with a predictable slug by pre-creating the directory structure
  slugDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(slugDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describeShell('gstack-review-log', () => {
  test('appends valid JSON to review JSONL file', () => {
    const input = '{"skill":"plan-eng-review","status":"clean"}';
    const result = run(input);
    expect(result.exitCode).toBe(0);

    // Find the JSONL file that was written
    const projectDirs = fs.readdirSync(slugDir);
    expect(projectDirs.length).toBeGreaterThan(0);
    const projectDir = path.join(slugDir, projectDirs[0]);
    const jsonlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    expect(jsonlFiles.length).toBeGreaterThan(0);

    const content = fs.readFileSync(path.join(projectDir, jsonlFiles[0]), 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.skill).toBe('plan-eng-review');
    expect(parsed.status).toBe('clean');
  });

  test('rejects non-JSON input with non-zero exit code', () => {
    const result = run('not json at all', { expectFail: true });
    expect(result.exitCode).not.toBe(0);

    // Verify nothing was written
    const projectDirs = fs.readdirSync(slugDir);
    if (projectDirs.length > 0) {
      const projectDir = path.join(slugDir, projectDirs[0]);
      const jsonlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
      if (jsonlFiles.length > 0) {
        const content = fs.readFileSync(path.join(projectDir, jsonlFiles[0]), 'utf-8').trim();
        expect(content).toBe('');
      }
    }
  });
});
