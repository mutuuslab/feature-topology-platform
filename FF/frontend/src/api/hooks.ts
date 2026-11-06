// react-query 훅 — 쿼리 키는 [API 이름, 매개변수, 질의]. 변경이 성공하면 관련 쿼리를 무효화한다.
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useAppShell } from '../store';
import type { AsyncState } from '../design';
import { ApiError, call, isPersonal, type CallOptions } from './client';

/** 조회 하나의 캐시 키·읽기 — useApi와 미리 읽기(prefetchQuery)가 같은 키를 쓰게 */
export function apiQuery<T = any>(name: string, opts: Pick<CallOptions, 'params' | 'query'>, role: string) {
  const personal = isPersonal(name);
  return {
    // 계정마다 다른 조회(내 알림)는 역할을 바꾸면 다시 읽는다
    queryKey: personal ? [name, opts.params ?? {}, opts.query ?? {}, role] : [name, opts.params ?? {}, opts.query ?? {}],
    queryFn: ({ signal }: { signal: AbortSignal }) => call<T>(name, { ...opts, signal, ...(personal ? { role } : {}) }),
  };
}

export function useApi<T = any>(
  name: string,
  opts: Pick<CallOptions, 'params' | 'query'> = {},
  q: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {},
) {
  const { role } = useAppShell();
  return useQuery<T, ApiError>({ ...apiQuery<T>(name, opts, role), ...q });
}

/** 변경 — 성공하면 invalidate에 적은 API 이름으로 시작하는 쿼리를 다시 읽는다 */
export function useApiMutation<T = any, V extends Pick<CallOptions, 'params' | 'body' | 'actorRole'> = Pick<CallOptions, 'params' | 'body' | 'actorRole'>>(name: string, invalidate: string[] = []) {
  const qc = useQueryClient();
  const { role } = useAppShell();
  return useMutation<T, ApiError, V>({
    mutationFn: (v) => call<T>(name, { ...v, role }),
    onSuccess: () => Promise.all(invalidate.map((n) => qc.invalidateQueries({ queryKey: [n] }))).then(() => undefined),
  });
}

/** 쿼리 상태 → AsyncView 상태 */
export function asyncState(q: { isPending: boolean; isError: boolean; error: ApiError | null }, empty = false): AsyncState {
  if (q.isPending) return 'loading';
  if (q.isError) return q.error?.status === 403 ? 'forbidden' : 'error';
  return empty ? 'empty' : 'ready';
}
