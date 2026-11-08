import { useSyncExternalStore } from 'react';
import { localeSnapshot, subscribeLocale } from './runtime';

// Updating UI language does not remount forms or change their API query keys.
export const useUiLocale = () => useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
