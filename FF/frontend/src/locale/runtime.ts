// UI copy only: user records, API identifiers and authorization values never pass through this lookup.
export type UiLanguage = 'ko' | 'en';
export type CopyOverrides<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : T extends string ? string : T extends readonly (infer U)[] ? readonly CopyOverrides<U>[] : T extends object ? { [K in keyof T]?: CopyOverrides<T[K]> } : T;
type Catalogue = Record<string, unknown>;
type LocaleState = { language: UiLanguage; requested: UiLanguage; loading: boolean; error: string | null; revision: number };
let current: LocaleState = { language: 'ko', requested: 'ko', loading: false, error: null, revision: 0 };
let english: Record<string, Catalogue> = {};
let loading: Promise<Record<string, Catalogue>> | null = null;
let request = 0;
const listeners = new Set<() => void>();
const missing = new Set<string>();
const cache = new WeakMap<object, Map<string, object>>();
export const localeSnapshot = () => current;
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(next: Omit<LocaleState, 'revision'>) {
  current = { ...next, revision: current.revision + 1 };
  for (const listener of listeners) listener();
}
export async function changeUiLanguage(language: UiLanguage): Promise<boolean> {
  const serial = ++request;
  if (language === 'ko') { publish({ language, requested: language, loading: false, error: null }); return true; }
  if (current.language === 'en') return true;
  publish({ ...current, requested: language, loading: true, error: null });
  try {
    loading ??= import('./english-catalogues').then((module) => module.loadEnglishCatalogues()).catch((error) => { loading = null; throw error; });
    const loaded = await loading;
    if (serial !== request) return false;
    english = loaded;
    publish({ language, requested: language, loading: false, error: null });
    return true;
  } catch {
    if (serial === request) publish({ language: current.language, requested: language, loading: false, error: 'EN_CATALOGUE_LOAD_FAILED' });
    return false;
  }
}
function translated(path: string): unknown {
  const [module, ...keys] = path.split('.');
  const flat = english[module]?.[keys.join('.')];
  if (flat !== undefined) return flat;
  let value: unknown = english[module];
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function localizedCopy<T extends object>(path: string, original: T): T {
  let paths = cache.get(original);
  const existing = paths?.get(path);
  if (existing) return existing as T;
  const proxy = new Proxy(original, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string') return value;
      const key = `${path}.${property}`;
      if (current.language === 'en') {
        const replacement = translated(key);
        if (typeof value === 'string' && typeof replacement === 'string') return replacement;
        if (typeof value === 'function' && typeof replacement === 'function') return replacement;
        if (typeof value === 'string' && /[가-힣]/.test(value)) missing.add(key);
        if (typeof value === 'function' && Object.hasOwn(target, property)) missing.add(key);
      }
      return value && typeof value === 'object' ? localizedCopy(key, value) : value;
    },
  });
  paths ??= new Map(); paths.set(path, proxy); cache.set(original, paths);
  return proxy;
}
export const untranslatedCopyPaths = () => [...missing].sort();

export function __resetLocaleForTest() {
  request += 1; english = {}; loading = null; missing.clear();
  publish({ language: 'ko', requested: 'ko', loading: false, error: null });
}
