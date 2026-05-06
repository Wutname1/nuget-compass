import { runDotnet } from './exec.js';
import { logger } from '../logging/logger.js';

export interface RemovePackageResult {
  success: boolean;
  output: string;
}

export async function removePackage(
  projectPath: string,
  cwd: string,
  packageId: string,
  options: { timeoutMs?: number } = {},
): Promise<RemovePackageResult> {
  const args = ['remove', projectPath, 'package', packageId];
  logger.info(`dotnet ${args.join(' ')}`);
  const result = await runDotnet(args, cwd, options.timeoutMs ?? 60_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  return { success: result.code === 0, output };
}
