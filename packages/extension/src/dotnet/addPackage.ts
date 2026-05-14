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
  options: { timeoutMs?: number } = {},
): Promise<AddPackageResult> {
  const args = ['add', projectPath, 'package', packageId, '--version', version];
  logger.info(`dotnet ${args.join(' ')}`);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 60_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  // `dotnet add package` writes the PackageReference even when its implicit
  // restore prints NU1605/NU1202. Treat those as failure so we surface a real
  // diagnostic instead of silently leaving a broken project on disk.
  const hasBlockingCode = BLOCKING_NU_CODES.some((code) =>
    new RegExp(`\\b${code}\\b`).test(output),
  );
  return {
    success: result.code === 0 && !hasBlockingCode,
    output,
  };
}
