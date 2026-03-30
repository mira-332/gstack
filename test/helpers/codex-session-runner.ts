/**
 * Codex CLI subprocess runner for skill E2E testing.
 *
 * Spawns `codex exec` as a completely independent process, parses its JSONL
 * output, and returns structured results. Follows the same pattern as
 * session-runner.ts but adapted for the Codex CLI.
 *
 * Key differences from Claude session-runner:
 * - Uses `codex exec` instead of `claude -p`
 * - Output is JSONL with different event types (item.completed, turn.completed, thread.started)
 * - Uses `--json` flag instead of `--output-format stream-json`
 * - Needs temp HOME with skill installed at ~/.codex/skills/{skillName}/SKILL.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveDefaultTrustFile, writeRuntimeTrustPin } from '../../browse/src/runtime-trust';

// --- Interfaces ---

export interface CodexResult {
  output: string;           // Full agent message text
  reasoning: string[];      // [codex thinking] blocks
  toolCalls: string[];      // [codex ran] commands
  tokens: number;           // Total tokens used
  exitCode: number;         // Process exit code
  durationMs: number;       // Wall clock time
  sessionId: string | null; // Thread ID for session continuity
  rawLines: string[];       // Raw JSONL lines for debugging
  stderr: string;           // Stderr output (skill loading errors, auth failures)
}

// --- JSONL parser (ported from Python in codex/SKILL.md.tmpl) ---

export interface ParsedCodexJSONL {
  output: string;
  reasoning: string[];
  toolCalls: string[];
  tokens: number;
  sessionId: string | null;
}

const CODEX_COMMAND_CANDIDATES = process.platform === 'win32'
  ? ['codex.exe', 'codex']
  : ['codex'];

const REVIEW_SIDECAR_FILES = [
  'checklist.md',
  'design-checklist.md',
  'greptile-triage.md',
  'TODOS-format.md',
];

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function copyPathIfExists(source: string, destination: string) {
  if (!pathExists(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true, dereference: true });
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function parseSkillMetadata(content: string): { name: string; description: string } {
  const normalized = normalizeLineEndings(content);
  if (!normalized.startsWith('---\n')) return { name: '', description: '' };

  const fmEnd = normalized.indexOf('\n---', 4);
  if (fmEnd === -1) return { name: '', description: '' };

  const frontmatter = normalized.slice(4, fmEnd);
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : '';

  let description = '';
  let inDescription = false;
  const descLines: string[] = [];

  for (const line of frontmatter.split('\n')) {
    if (/^description:\s*\|?\s*$/.test(line)) {
      inDescription = true;
      continue;
    }
    if (/^description:\s*\S/.test(line)) {
      description = line.replace(/^description:\s*/, '').trim();
      break;
    }
    if (inDescription) {
      if (line === '' || /^\s/.test(line)) {
        descLines.push(line.replace(/^  /, ''));
      } else {
        break;
      }
    }
  }

  if (descLines.length > 0) {
    description = descLines.join('\n').trim();
  }

  return { name, description };
}

function condenseOpenAIShortDescription(description: string): string {
  const firstParagraph = description.split(/\n\s*\n/)[0] || description;
  const collapsed = firstParagraph.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= 120) return collapsed;

  const truncated = collapsed.slice(0, 117);
  const lastSpace = truncated.lastIndexOf(' ');
  const safe = lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated;
  return `${safe}...`;
}

function generateOpenAIYaml(displayName: string, shortDescription: string): string {
  return `interface:
  display_name: ${JSON.stringify(displayName)}
  short_description: ${JSON.stringify(shortDescription)}
  default_prompt: ${JSON.stringify(`Use ${displayName} for this task.`)}
policy:
  allow_implicit_invocation: true
`;
}

export function resolveCodexCommand(): string | null {
  for (const command of CODEX_COMMAND_CANDIDATES) {
    try {
      const result = Bun.spawnSync([command, '--version']);
      if (result.exitCode === 0) return command;
    } catch {
      // Keep trying the other candidates.
    }
  }
  return null;
}

function installCodexRuntimeAssets(repoRoot: string, tempHome: string) {
  const runtimeRoot = path.join(tempHome, '.codex', 'skills', 'gstack');
  const runtimeDist = path.join(runtimeRoot, 'browse', 'dist');

  copyPathIfExists(path.join(repoRoot, 'bin'), path.join(runtimeRoot, 'bin'));
  copyPathIfExists(path.join(repoRoot, 'browse', 'dist'), runtimeDist);
  copyPathIfExists(path.join(repoRoot, 'browse', 'bin'), path.join(runtimeRoot, 'browse', 'bin'));
  copyPathIfExists(path.join(repoRoot, 'ETHOS.md'), path.join(runtimeRoot, 'ETHOS.md'));
  copyPathIfExists(path.join(repoRoot, 'gstack-upgrade', 'SKILL.md'), path.join(runtimeRoot, 'gstack-upgrade', 'SKILL.md'));

  for (const file of REVIEW_SIDECAR_FILES) {
    copyPathIfExists(path.join(repoRoot, 'review', file), path.join(runtimeRoot, 'review', file));
  }

  if (pathExists(path.join(runtimeDist, 'browse.exe')) || pathExists(path.join(runtimeDist, 'browse'))) {
    writeRuntimeTrustPin(runtimeDist, resolveDefaultTrustFile(tempHome));
  }
}

function seedGstackPreambleState(tempHome: string) {
  const gstackDir = path.join(tempHome, '.gstack');
  fs.mkdirSync(gstackDir, { recursive: true });

  for (const marker of ['.completeness-intro-seen', '.telemetry-prompted', '.proactive-prompted']) {
    const markerPath = path.join(gstackDir, marker);
    if (!pathExists(markerPath)) {
      fs.writeFileSync(markerPath, '');
    }
  }
}

/**
 * Parse an array of JSONL lines from `codex exec --json` into structured data.
 * Pure function — no I/O, no side effects.
 *
 * Handles these Codex event types:
 * - thread.started → extract thread_id (session ID)
 * - item.completed → extract reasoning, agent_message, command_execution
 * - turn.completed → extract token usage
 */
export function parseCodexJSONL(lines: string[]): ParsedCodexJSONL {
  const outputParts: string[] = [];
  const reasoning: string[] = [];
  const toolCalls: string[] = [];
  let tokens = 0;
  let sessionId: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const t = obj.type || '';

      if (t === 'thread.started') {
        const tid = obj.thread_id || '';
        if (tid) sessionId = tid;
      } else if (t === 'item.completed' && obj.item) {
        const item = obj.item;
        const itype = item.type || '';
        const text = item.text || '';

        if (itype === 'reasoning' && text) {
          reasoning.push(text);
        } else if (itype === 'agent_message' && text) {
          outputParts.push(text);
        } else if (itype === 'command_execution') {
          const cmd = item.command || '';
          if (cmd) toolCalls.push(cmd);
        }
      } else if (t === 'turn.completed') {
        const usage = obj.usage || {};
        const turnTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
        tokens += turnTokens;
      }
    } catch { /* skip malformed lines */ }
  }

  return {
    output: outputParts.join('\n'),
    reasoning,
    toolCalls,
    tokens,
    sessionId,
  };
}

// --- Skill installation helper ---

/**
 * Install a SKILL.md into a temp HOME directory for Codex to discover.
 * Creates ~/.codex/skills/{skillName}/SKILL.md in the temp HOME and copies
 * agents/openai.yaml when present so Codex sees the same metadata as a real install.
 *
 * Returns the temp HOME path. Caller is responsible for cleanup.
 */
export function installSkillToTempHome(
  skillDir: string,
  skillName: string,
  tempHome?: string,
): string {
  const home = tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'codex-e2e-'));
  const repoRoot = path.resolve(skillDir, '..', '..', '..');
  const destDir = path.join(home, '.codex', 'skills', skillName);
  fs.mkdirSync(destDir, { recursive: true });
  installCodexRuntimeAssets(repoRoot, home);

  const srcSkill = path.join(skillDir, 'SKILL.md');
  const skillContent = pathExists(srcSkill) ? fs.readFileSync(srcSkill, 'utf-8') : '';
  if (fs.existsSync(srcSkill)) {
    fs.copyFileSync(srcSkill, path.join(destDir, 'SKILL.md'));
  }

  const destAgentsDir = path.join(destDir, 'agents');
  fs.mkdirSync(destAgentsDir, { recursive: true });
  const { name, description } = parseSkillMetadata(skillContent);
  const displayName = name || skillName;
  const shortDescription = condenseOpenAIShortDescription(description) || `Use ${displayName} for this task.`;
  fs.writeFileSync(path.join(destAgentsDir, 'openai.yaml'), generateOpenAIYaml(displayName, shortDescription));

  return home;
}

// --- Main runner ---

/**
 * Run a Codex skill via `codex exec` and return structured results.
 *
 * Spawns codex in a temp HOME with the skill installed, parses JSONL output,
 * and returns a CodexResult. Skips gracefully if codex binary is not found.
 */
export async function runCodexSkill(opts: {
  skillDir: string;         // Path to skill directory containing SKILL.md
  prompt: string;           // What to ask Codex to do with the skill
  timeoutMs?: number;       // Default 300000 (5 min)
  cwd?: string;             // Working directory
  skillName?: string;       // Skill name for installation (default: dirname)
  sandbox?: string;         // Sandbox mode (default: 'workspace-write')
}): Promise<CodexResult> {
  const {
    skillDir,
    prompt,
    timeoutMs = 300_000,
    cwd,
    skillName,
    sandbox = 'workspace-write',
  } = opts;

  const startTime = Date.now();
  const name = skillName || path.basename(skillDir) || 'gstack';

  const codexCommand = resolveCodexCommand();
  if (!codexCommand) {
    return {
      output: 'SKIP: codex binary not found',
      reasoning: [],
      toolCalls: [],
      tokens: 0,
      exitCode: -1,
      durationMs: Date.now() - startTime,
      sessionId: null,
      rawLines: [],
      stderr: '',
    };
  }

  // Set up temp HOME with skill installed
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-e2e-'));
  const realHome = os.homedir();

  try {
    installSkillToTempHome(skillDir, name, tempHome);
    seedGstackPreambleState(tempHome);

    // Symlink real Codex auth config so codex can authenticate from temp HOME.
    // Codex stores auth in ~/.codex/ — we need the config but not the skills
    // (we install our own test skills above).
    const realCodexConfig = path.join(realHome, '.codex');
    const tempCodexDir = path.join(tempHome, '.codex');
    if (fs.existsSync(realCodexConfig)) {
      // Copy auth-related files from real ~/.codex/ into temp ~/.codex/
      // (skills/ is already set up by installSkillToTempHome)
      const entries = fs.readdirSync(realCodexConfig);
      for (const entry of entries) {
        if (entry === 'skills') continue; // don't clobber our test skills
        const src = path.join(realCodexConfig, entry);
        const dst = path.join(tempCodexDir, entry);
        if (!fs.existsSync(dst)) {
          fs.cpSync(src, dst, { recursive: true });
        }
      }
    }

    // Build codex exec command
    const args = ['exec', prompt, '--json', '-s', sandbox];

    // Spawn codex with temp HOME so it discovers our installed skill
    const proc = Bun.spawn([codexCommand, ...args], {
      cwd: cwd || skillDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        HOME: tempHome,
        ...(process.platform === 'win32'
          ? {
              USERPROFILE: tempHome,
              HOMEDRIVE: path.parse(tempHome).root.replace(/[\\\/]+$/, ''),
              HOMEPATH: tempHome.slice(path.parse(tempHome).root.length - 1),
            }
          : {}),
      },
    });

    // Race against timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    // Stream and collect JSONL from stdout
    const collectedLines: string[] = [];
    const stderrPromise = new Response(proc.stderr).text();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          collectedLines.push(line);

          // Real-time progress to stderr
          try {
            const event = JSON.parse(line);
            if (event.type === 'item.completed' && event.item) {
              const item = event.item;
              if (item.type === 'command_execution' && item.command) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                process.stderr.write(`  [codex ${elapsed}s] ran: ${item.command.slice(0, 100)}\n`);
              } else if (item.type === 'agent_message' && item.text) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                process.stderr.write(`  [codex ${elapsed}s] message: ${item.text.slice(0, 100)}\n`);
              }
            }
          } catch { /* skip — parseCodexJSONL will handle it later */ }
        }
      }
    } catch { /* stream read error — fall through to exit code handling */ }

    // Flush remaining buffer
    if (buf.trim()) {
      collectedLines.push(buf);
    }

    const stderr = await stderrPromise;
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;

    // Parse all collected JSONL lines
    const parsed = parseCodexJSONL(collectedLines);

    // Log stderr if non-empty (may contain auth errors, etc.)
    if (stderr.trim()) {
      process.stderr.write(`  [codex stderr] ${stderr.trim().slice(0, 200)}\n`);
    }

    return {
      output: parsed.output,
      reasoning: parsed.reasoning,
      toolCalls: parsed.toolCalls,
      tokens: parsed.tokens,
      exitCode: timedOut ? 124 : exitCode,
      durationMs,
      sessionId: parsed.sessionId,
      rawLines: collectedLines,
      stderr,
    };
  } finally {
    // Clean up temp HOME
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* non-fatal */ }
  }
}
