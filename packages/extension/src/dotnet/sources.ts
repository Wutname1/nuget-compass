import { runDotnet } from './exec.js';

export interface SourceMutationResult {
  success: boolean;
  output: string;
}

async function runSourceCommand(args: string[], cwd: string): Promise<SourceMutationResult> {
  const result = await runDotnet(args, cwd, 30_000);
  const output = [result.stdout, result.stderr].filter((s) => s.trim().length > 0).join('\n');
  return { success: result.code === 0, output };
}

export function addSource(
  cwd: string,
  name: string,
  url: string,
  options: { username?: string; password?: string; storePasswordInClearText?: boolean } = {},
): Promise<SourceMutationResult> {
  const args = ['nuget', 'add', 'source', url, '--name', name];
  if (options.username) args.push('--username', options.username);
  if (options.password) args.push('--password', options.password);
  if (options.storePasswordInClearText) args.push('--store-password-in-clear-text');
  return runSourceCommand(args, cwd);
}

export function removeSource(cwd: string, name: string): Promise<SourceMutationResult> {
  return runSourceCommand(['nuget', 'remove', 'source', name], cwd);
}

export function enableSource(cwd: string, name: string): Promise<SourceMutationResult> {
  return runSourceCommand(['nuget', 'enable', 'source', name], cwd);
}

export function disableSource(cwd: string, name: string): Promise<SourceMutationResult> {
  return runSourceCommand(['nuget', 'disable', 'source', name], cwd);
}
