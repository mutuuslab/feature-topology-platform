import { changeUiLanguage, type UiLanguage } from '../locale/runtime';

/** Display preference only. External identities, roles and record state never use this value. */
export function savedExternalLanguage(value: string | null): UiLanguage {
  try { return JSON.parse(value ?? '{}')?.lang === 'en' ? 'en' : 'ko'; }
  catch { return 'ko'; }
}

export async function initializeExternalLanguage(): Promise<void> {
  let value: string | null = null;
  try { value = localStorage.getItem('fp.state.v2'); } catch { /* Storage restrictions retain Korean fallback. */ }
  await changeUiLanguage(savedExternalLanguage(value));
}

export function subscribeExternalLanguage(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'fp.state.v2') void changeUiLanguage(savedExternalLanguage(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
