import { afterEach, expect, it, vi } from 'vitest';
import { alm } from '../copy/alm';
import { almInbox } from '../copy/alm-inbox';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
import * as catalogues from '../locale/english-catalogues';
afterEach(() => { vi.restoreAllMocks(); __resetLocaleForTest(); });

it('reconciliation display language preserves canonical kinds, original titles and unknown field identifiers', async () => {
  const keys=Object.keys(alm.reconcile.kind);
  expect(alm.reconcile.kind.INCREMENTAL).toBe('증분 대사');
  await changeUiLanguage('en');
  expect(alm.reconcile.kind.INCREMENTAL).toBe('Incremental reconciliation');
  expect(alm.reconcile.kind.FULL).toBe('Full reconciliation');
  expect(Object.keys(alm.reconcile.kind)).toEqual(keys);
  expect(alm.rejudge.detail('사용자가 작성한 제목',0,1000,true)).toBe('사용자가 작성한 제목 v0 → v1000 · Released version');
  expect(alm.conflictField('status')).toBe('Status');
  expect(alm.conflictField('country')).toBe('Country');
  expect(alm.conflictField('작성자_외부필드')).toBe('작성자_외부필드');
  expect(almInbox.conflictField('작성자_외부필드')).toBe('작성자_외부필드');
  await changeUiLanguage('ko');
  expect(alm.rejudge.detail('사용자 제목',1,2,true)).toBe('사용자 제목 v1 → v2 · 출시 버전');
});

it('a missing parent override delegates aliases to the child catalogue at call time', async () => {
  const real=await catalogues.loadEnglishCatalogues();
  const parent={...real.alm};
  delete parent['alm.rejudge.detail']; delete parent['alm.conflictField'];
  vi.spyOn(catalogues,'loadEnglishCatalogues').mockResolvedValueOnce({...real,alm:parent});
  await changeUiLanguage('en');
  expect(alm.rejudge.detail('원문',1,2,true)).toBe('원문 v1 → v2 · Released version');
  expect(alm.conflictField('status')).toBe('Status');
  expect(alm.conflictField('외부_원문_키')).toBe('외부_원문_키');
});
