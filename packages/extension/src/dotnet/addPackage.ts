import { runDotnet } from './exec.js';
import { logger } from '../logging/logger.js';

export interface AddPackageResult {
  success: boolean;
  /** Combined stdout + stderr from the dotnet invocation. */
  output: string;
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
  options: { timeoutMs?: number } = {},
): Promise<AddPackageResult> {
  const args = ['add', projectPath, 'package', packageId, '--version', version];
  logger.info(`dotnet ${args.join(' ')}`);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 60_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  return {
    success: result.code === 0,
    output,
  };
}
