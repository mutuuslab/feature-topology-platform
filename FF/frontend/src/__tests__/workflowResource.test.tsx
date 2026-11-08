import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { useWorkflowResource } from '../data/workflows';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../contracts/src/generated/workflow-loader', () => ({ loadWorkflowDocument: api.load }));
afterEach(() => { cleanup(); __resetLocaleForTest(); });
it('문서 요청 실패 뒤 재시도는 캐시된 거절을 재사용하지 않고 실제 모델을 다시 읽는다', async () => {
  api.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(WORKFLOWS);
  const { result } = renderHook(() => useWorkflowResource());
  await waitFor(() => expect(result.current.doc).toBe('fail'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.doc && result.current.doc !== 'fail' ? result.current.doc.processes.length : 0).toBe(18));
  expect(api.load).toHaveBeenCalledTimes(2);
});

it('언어 전환은 로드된 원천을 다시 요청하지 않고 기존 절차 view를 갱신한다', async () => {
  const { result } = renderHook(() => useWorkflowResource());
  await waitFor(() => expect(result.current.doc && result.current.doc !== 'fail' ? result.current.doc.processes[0].name : '').toBe('Feature 등록·분류'));
  const calls = api.load.mock.calls.length;
  await act(async () => { await changeUiLanguage('en'); });
  expect(result.current.doc && result.current.doc !== 'fail' ? result.current.doc.processes[0].name : '').toBe(WORKFLOWS.processes[0].en);
  expect(api.load).toHaveBeenCalledTimes(calls);
  await act(async () => { await changeUiLanguage('ko'); });
  expect(result.current.doc && result.current.doc !== 'fail' ? result.current.doc.processes[0].name : '').toBe('Feature 등록·분류');
});
