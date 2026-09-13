import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

/**
 * 기준 데이터처럼 화면 진입 시 읽는 비동기 값을 위한 최소 훅.
 * 이전 요청 결과가 뒤늦게 도착해도 현재 요청만 화면에 반영한다.
 */
export function useAsync<T>(factory: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const seq = useRef(0);
  const run = useRef(factory);
  run.current = factory;
  useEffect(() => {
    const id = ++seq.current;
    setState({ loading: true });
    run.current().then(
      (data) => { if (id === seq.current) setState({ data, loading: false }); },
      (error: Error) => { if (id === seq.current) setState({ error, loading: false }); },
    );
    return () => { seq.current++; };
  }, deps);
  return state;
}
