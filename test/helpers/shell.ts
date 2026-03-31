import { execFileSync, spawnSync, type ExecFileSyncOptionsWithStringEncoding, type SpawnSyncOptions } from 'child_process';
import { resolveBashExecutable, resolveGitExecutable, resolveNodeExecutable } from '../../scripts/bun-exec';

export const BASH = resolveBashExecutable();
export const GIT = resolveGitExecutable();
export const NODE = resolveNodeExecutable();

export function spawnBashScript(
  scriptPath: string,
  args: string[] = [],
  options: SpawnSyncOptions = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(BASH, [scriptPath, ...args], {
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout?.toString().trim() ?? '',
    stderr: result.stderr?.toString().trim() ?? '',
  };
}

export function execBashScript(
  scriptPath: string,
  args: string[] = [],
  options: ExecFileSyncOptionsWithStringEncoding = {},
): string {
  return execFileSync(BASH, [scriptPath, ...args], {
    ...options,
    encoding: 'utf-8',
  }).trim();
}
