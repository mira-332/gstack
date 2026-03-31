/**
 * Shared config for browse CLI + server.
 *
 * Resolution:
 *   1. BROWSE_STATE_FILE env → derive stateDir from parent
 *   2. git rev-parse --show-toplevel → projectDir/.gstack/
 *   3. process.cwd() fallback (non-git environments)
 *
 * The CLI computes the config and passes BROWSE_STATE_FILE to the
 * spawned server. The server derives all paths from that env var.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BrowseConfig {
  projectDir: string;
  stateDir: string;
  stateFile: string;
  userStateDir: string;
  secretStateFile: string;
  consoleLog: string;
  networkLog: string;
  dialogLog: string;
}

export interface BrowsePublicState {
  pid: number;
  port: number;
  startedAt: string;
  serverPath: string;
  binaryVersion?: string;
  secretStateFile: string;
}

export interface BrowseSecretState {
  token: string;
  createdAt: string;
}

export interface ProjectIdentity {
  repoUrl: string;
  repoSlug: string;
  source: 'env' | 'claude' | 'origin' | 'cwd';
}

/**
 * Detect the git repository root, or null if not in a repo / git unavailable.
 */
export function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000, // Don't hang if .git is broken
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

function normalizeRepoSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '');
}

function slugFromRepoUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, '');
  const match = trimmed.match(/[:/]([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return normalizeRepoSlug(`${match[1]}-${match[2]}`);
}

function readMarkdownField(block: string, label: string): string {
  const match = block.match(new RegExp(`^-[\\s]*${label}:[\\s]*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function readClaudeSection(projectDir: string, heading: string): string {
  const claudePath = path.join(projectDir, 'CLAUDE.md');
  try {
    const content = fs.readFileSync(claudePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const section: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (line === `## ${heading}`) {
        inSection = true;
        section.push(line);
        continue;
      }
      if (inSection && line.startsWith('## ')) break;
      if (inSection) section.push(line);
    }
    return section.join('\n');
  } catch {
    return '';
  }
}

export function resolveProjectIdentity(
  projectDir: string = getGitRoot() || process.cwd(),
  env: Record<string, string | undefined> = process.env,
): ProjectIdentity {
  const envUrl = env.GSTACK_REPO_URL || env.BROWSE_REPO_URL || '';
  const envSlug = env.GSTACK_REPO_SLUG || env.BROWSE_REPO_SLUG || '';
  if (envUrl || envSlug) {
    return {
      repoUrl: envUrl,
      repoSlug: normalizeRepoSlug(envSlug || slugFromRepoUrl(envUrl) || path.basename(projectDir)),
      source: 'env',
    };
  }

  const projectBlock = readClaudeSection(projectDir, 'Project Identity');
  const deployBlock = readClaudeSection(projectDir, 'Deploy Configuration');
  const claudeUrl = readMarkdownField(projectBlock, 'Repository URL') || readMarkdownField(deployBlock, 'Repository URL');
  const claudeSlug = readMarkdownField(projectBlock, 'Repository Slug') || readMarkdownField(deployBlock, 'Repository Slug');
  if (claudeUrl || claudeSlug) {
    return {
      repoUrl: claudeUrl,
      repoSlug: normalizeRepoSlug(claudeSlug || slugFromRepoUrl(claudeUrl) || path.basename(projectDir)),
      source: 'claude',
    };
  }

  try {
    const proc = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000,
    });
    if (proc.exitCode === 0) {
      const origin = proc.stdout.toString().trim();
      const slug = slugFromRepoUrl(origin) || normalizeRepoSlug(path.basename(projectDir));
      return {
        repoUrl: origin,
        repoSlug: slug,
        source: 'origin',
      };
    }
  } catch {
    // fall through to cwd
  }

  return {
    repoUrl: '',
    repoSlug: normalizeRepoSlug(path.basename(projectDir)),
    source: 'cwd',
  };
}

/**
 * Resolve the user-scoped runtime state directory used for secret-bearing data.
 *
 * On Windows this maps to LOCALAPPDATA by default. On Unix-like systems it uses
 * XDG_STATE_HOME when available, otherwise ~/.local/state.
 */
export function resolveUserStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.BROWSE_USER_STATE_DIR) {
    return path.resolve(env.BROWSE_USER_STATE_DIR);
  }

  const baseDir = process.platform === 'win32'
    ? (env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'));

  return path.join(baseDir, 'gstack', 'browse');
}

/**
 * Resolve all browse config paths.
 *
 * If BROWSE_STATE_FILE is set (e.g. by CLI when spawning server, or by
 * tests for isolation), all paths are derived from it. Otherwise, the
 * project root is detected via git or cwd.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): BrowseConfig {
  let stateFile: string;
  let stateDir: string;
  let projectDir: string;

  if (env.BROWSE_STATE_FILE) {
    stateFile = env.BROWSE_STATE_FILE;
    stateDir = path.dirname(stateFile);
    projectDir = path.dirname(stateDir); // parent of .gstack/
  } else {
    projectDir = getGitRoot() || process.cwd();
    stateDir = path.join(projectDir, '.gstack');
    stateFile = path.join(stateDir, 'browse.json');
  }

  const userStateDir = resolveUserStateDir(env);
  const secretStateFile = path.join(userStateDir, 'browse-auth.json');

  return {
    projectDir,
    stateDir,
    stateFile,
    userStateDir,
    secretStateFile,
    consoleLog: path.join(stateDir, 'browse-console.log'),
    networkLog: path.join(stateDir, 'browse-network.log'),
    dialogLog: path.join(stateDir, 'browse-dialog.log'),
  };
}

/**
 * Create the user-scoped secret state directory.
 */
export function ensureUserStateDir(config: BrowseConfig): void {
  try {
    fs.mkdirSync(config.userStateDir, { recursive: true });
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create user state directory ${config.userStateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create user state directory ${config.userStateDir}: a file exists at that path`);
    }
    throw err;
  }
}

/**
 * Build the public state payload written into the repo-local .gstack file.
 * Secret-bearing fields are intentionally excluded.
 */
export function createPublicState(
  config: BrowseConfig,
  state: Omit<BrowsePublicState, 'secretStateFile'>,
): BrowsePublicState {
  return {
    ...state,
    secretStateFile: config.secretStateFile,
  };
}

/**
 * Create the .gstack/ state directory if it doesn't exist.
 * Throws with a clear message on permission errors.
 */
export function ensureStateDir(config: BrowseConfig): void {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true });
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create state directory ${config.stateDir}: a file exists at that path`);
    }
    throw err;
  }

  // Ensure .gstack/ is in the project's .gitignore
  const gitignorePath = path.join(config.projectDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.match(/^\.gstack\/?$/m)) {
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}.gstack/\n`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // Write warning to server log (visible even in daemon mode)
      const logPath = path.join(config.stateDir, 'browse-server.log');
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Warning: could not update .gitignore at ${gitignorePath}: ${err.message}\n`);
      } catch {
        // stateDir write failed too — nothing more we can do
      }
    }
    // ENOENT (no .gitignore) — skip silently
  }
}

/**
 * Derive a slug from the git remote origin URL (owner-repo format).
 * Falls back to the directory basename if no remote is configured.
 */
export function getRemoteSlug(): string {
  return resolveProjectIdentity().repoSlug;
}

/**
 * Read the binary version (git SHA) from browse/dist/.version.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readVersionHash(execPath: string = process.execPath): string | null {
  try {
    const versionFile = path.resolve(path.dirname(execPath), '.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}
