import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppProvider, useAppApi, useAppShell } from '../store';
import { proposeGuide } from '../copy/propose-guide';
import { hasPrdOutline, isPrdTemplate, prdTemplate } from '../copy/propose-prd';
import { changeUiLanguage, localeSnapshot, localizedCopy, __resetLocaleForTest, untranslatedCopyPaths } from '../locale/runtime';
import * as catalogues from '../locale/english-catalogues';
import { useUiLocale } from '../locale/react';
import { ROUTES, rolesOf, routeOf } from '../routes';
import { DepartmentSelect } from '../shell/DepartmentSwitcher';
import { DEPARTMENTS } from '../data/departments';
import { procedures } from '../copy/procedures';
import { QUEUE_LABEL, QUEUE_ROLE } from '../copy/inbox';
import { StatusBadge } from '../screens/flag-code/badge';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); __resetLocaleForTest(); });

describe('reactive UI language catalogues', () => {
  it('coverage badges translate display captions while retaining the canonical status and release-block severity', async () => {
    const {container}=render(<StatusBadge status="NO_CODE" severity="BLOCKER"/>);
    expect(screen.getByText('코드 없음')).toBeTruthy();
    const badge=container.querySelector('[data-status]');
    await act(async()=>{await changeUiLanguage('en');});
    expect(screen.getByText('No code')).toBeTruthy();
    expect(badge).toHaveAttribute('data-status','NO_CODE');
    expect(badge).toHaveAttribute('data-sev','BLOCKER');
    await act(async()=>{await changeUiLanguage('ko');});
    expect(screen.getByText('코드 없음')).toBeTruthy();
  });
  it('delegated strings and inherited queue captions read their active child catalogue without changing queue keys', async () => {
    const real=await catalogues.loadEnglishCatalogues();
    const keys=Object.keys(QUEUE_LABEL), roleKeys=Object.keys(QUEUE_ROLE);
    const original=QUEUE_LABEL.baseline;
    vi.spyOn(catalogues,'loadEnglishCatalogues').mockResolvedValueOnce({...real,master:{...real.master,'master.inbox.queues.baseline':'Inherited Baseline request','master.inbox.roles.baseline':'Inherited BOM approver'}});
    await changeUiLanguage('en');
    expect(procedures.loading).toBe('Loading workflows.');
    expect(procedures.loadFail).not.toMatch(/[가-힣]/);
    expect(QUEUE_LABEL.baseline).toBe('Inherited Baseline request');
    expect(QUEUE_ROLE.baseline).toBe('Inherited BOM approver');
    expect(Object.keys(QUEUE_LABEL)).toEqual(keys); expect(Object.keys(QUEUE_ROLE)).toEqual(roleKeys);
    await changeUiLanguage('ko'); expect(QUEUE_LABEL.baseline).toBe(original);
  });
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
  it('the same language-button target retries after a failed stored preference', async () => {
    const original = catalogues.loadEnglishCatalogues;
    vi.spyOn(catalogues, 'loadEnglishCatalogues').mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(original);
    function Switcher() {
      const { lang } = useAppShell(); const { dispatch } = useAppApi(); const locale = useUiLocale();
      return <><p>{proposeGuide.title}</p>{locale.error && <p>load-error</p>}<button disabled={locale.loading} onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}>switch</button></>;
    }
    render(<AppProvider><Switcher /></AppProvider>);
    fireEvent.click(screen.getByText('switch')); await screen.findByText('load-error');
    fireEvent.click(screen.getByText('switch')); await screen.findByText('Writing guide and automatic fields');
  });
  it('new outlines follow the selected language while existing outlines and template-only validation survive switching', async () => {
    const korean = prdTemplate();
    expect(korean).toContain('[배경과 문제]');
    await changeUiLanguage('en');
    const english = prdTemplate();
    expect(english).toContain('[Background and problem]');
    expect(hasPrdOutline(korean)).toBe(true);
    expect(isPrdTemplate(english)).toBe(true);
    await changeUiLanguage('ko');
    expect(hasPrdOutline(english)).toBe(true);
    expect(isPrdTemplate(english)).toBe(true);
    expect(isPrdTemplate(english + '\nActual expected behavior')).toBe(false);
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
  it('translates all static route captions while preserving paths, menu structure and access roles', async () => {
    const identity = () => ROUTES.map((route) => ({ path: route.path, menu: route.menu, parent: route.parent, group: route.group, roles: rolesOf(route) }));
    const before = identity();
    await changeUiLanguage('en');
    expect(ROUTES.filter((route) => /[가-힣]/.test(route.title)).map((route) => route.path)).toEqual([]);
    expect(routeOf('/feature/propose')?.title).toBe('Register a Feature');
    expect(identity()).toEqual(before);
    await changeUiLanguage('ko');
    expect(routeOf('/feature/propose')?.title).toBe('Feature 등록');
  });
  it('updates department display names without changing selection or source RACI', async () => {
    const onChange = vi.fn();
    const before = JSON.stringify(DEPARTMENTS);
    render(<AppProvider><DepartmentSelect value="DEP-ITSEC" onChange={onChange} /></AppProvider>);
    const select = document.querySelector('[data-dept-select]');
    await act(async () => { await changeUiLanguage('en'); });
    expect(screen.getByRole('option', { name: 'Feature Control Center', exact: true })).toBeTruthy();
    expect(select).toHaveValue('DEP-ITSEC');
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(DEPARTMENTS)).toBe(before);
  });
});
