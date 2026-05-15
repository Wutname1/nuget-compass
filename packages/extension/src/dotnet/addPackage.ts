import { runDotnet } from './exec.js';
import { logger } from '../logging/logger.js';

export interface AddPackageResult {
  success: boolean;
  /** Combined stdout + stderr from the dotnet invocation. */
  output: string;
}

/**
 * NU-codes that mean the .csproj was edited but restore is broken. `dotnet add
 * package` happily exits 0 in those cases, leaving the project file in a state
 * that breaks every downstream restore until the user intervenes. We promote
 * these to "failure" so callers surface diagnostics instead of declaring
 * success.
 */
const BLOCKING_NU_CODES = ['NU1605', 'NU1202', 'NU1107'];

export interface AddPackageOptions {
  timeoutMs?: number;
  /**
   * Skip the implicit `dotnet restore` that `add package` does after writing
   * the .csproj. Use this during a bulk update so the loop only touches each
   * project file once per package; the caller is responsible for running a
   * single restore after every add lands. This avoids cascading NU1605s
   * during the loop — intermediate states like "EFCore 10 wants Logging 10
   * but Logging is still pinned at 8" are transient and disappear once all
   * the updates have been written.
   */
  skipRestore?: boolean;
}

/**
 * Run `dotnet add <project> package <id> --version <version>`.
 *
 * The SDK refuses incompatible installs with NU1202; we surface that error
 * verbatim. Caller is responsible for refreshing the project state on success.
 */
export async function addPackage(
  projectPath: string,
  cwd: string,
  packageId: string,
  version: string,
  options: AddPackageOptions = {},
): Promise<AddPackageResult> {
  const args = ['add', projectPath, 'package', packageId, '--version', version];
  if (options.skipRestore) args.push('--no-restore');
  logger.info(`dotnet ${args.join(' ')}`);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 60_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  // `dotnet add package` writes the PackageReference even when its implicit
  // restore prints NU1605/NU1202. Treat those as failure so we surface a real
  // diagnostic instead of silently leaving a broken project on disk. With
  // --no-restore there's no restore output to scan, so this check is a no-op
  // there; the caller's post-loop `restoreProject` does the equivalent.
  const hasBlockingCode = BLOCKING_NU_CODES.some((code) =>
    new RegExp(`\\b${code}\\b`).test(output),
  );
  return {
    success: result.code === 0 && !hasBlockingCode,
    output,
  };
}
