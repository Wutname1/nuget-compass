import { runDotnet } from './exec.js';
import { logger } from '../logging/logger.js';

export interface RestoreResult {
  success: boolean;
  /** Combined stdout + stderr from `dotnet restore`. */
  output: string;
}

const BLOCKING_NU_CODES = ['NU1605', 'NU1202', 'NU1107'];

/**
 * Run `dotnet restore <project>`. Used after a bulk update where every add
 * skipped its implicit restore so the conflict resolution runs once, against
 * the final version set in the .csproj.
 *
 * Promotes NU1605 / NU1202 / NU1107 in the output to a failure so the caller
 * can surface a real diagnostic — the same treatment addPackage gives its
 * own implicit restore.
 */
export async function restoreProject(
  projectPath: string,
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<RestoreResult> {
  const args = ['restore', projectPath];
  logger.info(`dotnet ${args.join(' ')}`);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 120_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  const hasBlockingCode = BLOCKING_NU_CODES.some((code) =>
    new RegExp(`\\b${code}\\b`).test(output),
  );
  return {
    success: result.code === 0 && !hasBlockingCode,
    output,
  };
}
