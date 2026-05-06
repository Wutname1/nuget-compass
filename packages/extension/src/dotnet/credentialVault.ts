import type * as vscode from 'vscode';

const SECRET_PREFIX = 'nuget-compass.source.';

interface StoredCred {
  username: string;
  password: string;
}

/**
 * Stores credentials in VS Code SecretStorage and converts them into the
 * `NuGetPackageSourceCredentials_<NAME>` env var format that NuGet's CLI/SDK
 * honours at restore/list time. Sources keyed in nuget.config without a
 * password line will pick up credentials from these env vars when present.
 */
export class CredentialVault {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  private key(sourceName: string): string {
    return `${SECRET_PREFIX}${sourceName}`;
  }

  async store(sourceName: string, username: string, password: string): Promise<void> {
    const payload: StoredCred = { username, password };
    await this.secrets.store(this.key(sourceName), JSON.stringify(payload));
  }

  async get(sourceName: string): Promise<StoredCred | undefined> {
    const raw = await this.secrets.get(this.key(sourceName));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredCred;
      if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  async delete(sourceName: string): Promise<void> {
    await this.secrets.delete(this.key(sourceName));
  }

  /**
   * Build the env var bag for every source we have a stored credential for.
   * NuGet expects `NuGetPackageSourceCredentials_<NAME>=Username=u;Password=p`.
   * Source names are case-sensitive in the env var name.
   */
  async buildEnv(sourceNames: string[]): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const name of sourceNames) {
      const cred = await this.get(name);
      if (!cred) continue;
      env[`NuGetPackageSourceCredentials_${name}`] =
        `Username=${cred.username};Password=${cred.password}`;
    }
    return env;
  }
}
