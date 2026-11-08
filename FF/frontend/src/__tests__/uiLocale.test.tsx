import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppProvider, useAppApi, useAppShell } from '../store';
import { proposeGuide } from '../copy/propose-guide';
import { changeUiLanguage, localeSnapshot, localizedCopy, __resetLocaleForTest, untranslatedCopyPaths } from '../locale/runtime';
import * as catalogues from '../locale/english-catalogues';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); __resetLocaleForTest(); });

describe('reactive UI language catalogues', () => {
  it('switches body copy and interpolated UI text without remounting or translating a draft', async () => {
    localStorage.clear();
    function Draft() {
      const { lang } = useAppShell(); const { dispatch } = useAppApi();
      const [text, setText] = useState('사용자가 작성한 기능 이름');
      return <><p>{proposeGuide.startTitle}</p><p>{proposeGuide.ownerAccount('김태호')}</p><input aria-label="draft" value={text} onChange={(event) => setText(event.target.value)} /><button onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}>toggle</button></>;
    }
    render(<AppProvider><Draft /></AppProvider>);
    const field = screen.getByLabelText('draft');
    fireEvent.change(field, { target: { value: '직접 작성한 변경 내용' } });
    fireEvent.click(screen.getByText('toggle'));
    await screen.findByText('Select a Feature DB reference first');
    expect(screen.getByText('Default owner: 김태호 (current account).')).toBeTruthy();
    expect(screen.getByLabelText('draft')).toBe(field);
    expect(field).toHaveValue('직접 작성한 변경 내용');
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByText('toggle'));
    await screen.findByText('Feature DB 기준을 먼저 선택하세요');
    expect(field).toHaveValue('직접 작성한 변경 내용');
  });
  it('keeps the current language after a failed load and retries the lazy catalogue', async () => {
    const original = catalogues.loadEnglishCatalogues;
    const loader = vi.spyOn(catalogues, 'loadEnglishCatalogues').mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(original);
    expect(await changeUiLanguage('en')).toBe(false);
    expect(localeSnapshot()).toMatchObject({ language: 'ko', loading: false, error: 'EN_CATALOGUE_LOAD_FAILED' });
    expect(await changeUiLanguage('en')).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(proposeGuide.title).toBe('Writing guide and automatic fields');
  });
  it('a cancelled language request cannot overwrite the newer selection', async () => {
    let finish!: (value: Record<string, Record<string, unknown>>) => void;
    vi.spyOn(catalogues, 'loadEnglishCatalogues').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const earlier = changeUiLanguage('en');
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await changeUiLanguage('ko'); finish({});
    expect(await earlier).toBe(false);
    expect(localeSnapshot()).toMatchObject({ language: 'ko', loading: false });
  });
  it('untranslated UI paths remain visible and are recorded; arbitrary user data is untouched', async () => {
    await changeUiLanguage('en');
    const source = localizedCopy('test.sample', { missing: '아직 번역하지 않은 안내', code: 'SAFETY_OFFICER' });
    expect(source.missing).toBe('아직 번역하지 않은 안내');
    expect(source.code).toBe('SAFETY_OFFICER');
    expect(untranslatedCopyPaths()).toContain('test.sample.missing');
    expect({ name: 'Feature DB 기준을 먼저 선택하세요' }.name).toBe('Feature DB 기준을 먼저 선택하세요');
  });
});
