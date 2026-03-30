import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installSkillToTempHome, resolveCodexCommand } from './codex-session-runner';

const ROOT = path.resolve(import.meta.dir, '..', '..');

describe('codex-session-runner helpers', () => {
  test('resolveCodexCommand returns a usable codex binary when available', () => {
    const command = resolveCodexCommand();
    if (command === null) return;

    expect(command === 'codex' || command === 'codex.exe').toBe(true);
  });

  test('installSkillToTempHome installs runtime sidecars and synthesized metadata', () => {
    const skillDir = path.join(ROOT, '.agents', 'skills', 'gstack-review');
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-runner-test-'));

    try {
      installSkillToTempHome(skillDir, 'gstack-review', tempHome);

      const skillHome = path.join(tempHome, '.codex', 'skills', 'gstack-review');
      const runtimeHome = path.join(tempHome, '.codex', 'skills', 'gstack');

      expect(fs.existsSync(path.join(skillHome, 'SKILL.md'))).toBe(true);

      const openaiYaml = fs.readFileSync(path.join(skillHome, 'agents', 'openai.yaml'), 'utf-8');
      expect(openaiYaml).toContain('display_name:');
      expect(openaiYaml).toContain('short_description:');
      expect(openaiYaml).not.toContain('short_description: ""');

      expect(fs.existsSync(path.join(runtimeHome, 'bin', 'gstack-update-check'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeHome, 'review', 'checklist.md'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeHome, 'review', 'greptile-triage.md'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeHome, 'review', 'TODOS-format.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempHome, '.gstack', 'trust', 'gstack-browse-runtime.json'))).toBe(true);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
