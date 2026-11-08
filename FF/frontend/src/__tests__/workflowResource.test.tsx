import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { useWorkflowResource } from '../data/workflows';
const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../contracts/src/generated/workflow-loader', () => ({ loadWorkflowDocument: api.load }));
afterEach(cleanup);
it('문서 요청 실패 뒤 재시도는 캐시된 거절을 재사용하지 않고 실제 모델을 다시 읽는다', async () => {
  api.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(WORKFLOWS);
  const { result } = renderHook(() => useWorkflowResource());
  await waitFor(() => expect(result.current.doc).toBe('fail'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.doc && result.current.doc !== 'fail' ? result.current.doc.processes.length : 0).toBe(18));
  expect(api.load).toHaveBeenCalledTimes(2);
});
