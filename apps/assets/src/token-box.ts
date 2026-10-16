import { unlockTokenBox } from '@pwa-apps/shared';
const raw = import.meta.env.VITE_GITHUB_TOKEN_BOX as string | undefined;
export const hasBundledToken = Boolean(raw?.trim());
export async function unlockBundledToken(passphrase: string): Promise<string> {
  return unlockTokenBox(raw || '', passphrase);
}
