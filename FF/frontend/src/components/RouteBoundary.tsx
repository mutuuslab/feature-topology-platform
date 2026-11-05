import { Component, type ReactNode } from 'react';
import { ErrorState } from './patterns';
import { routeRecovery } from '../copy/route-recovery';

export const isChunkLoadError = (error: Error) => /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk .+ failed|importing a module script failed/i.test(error.message);

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * 화면 하나의 렌더 실패가 제품 전체를 비우지 않도록 라우트 경계를 세운다.
 * 경로가 바뀌면 key 가 달라져 경계가 초기화된다(App 참조).
 */
export default class RouteBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('[route]', error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // data-route-error — e2e 메뉴 크롤이 화면 렌더 실패를 잡는 표식
    const updated = isChunkLoadError(error);
    return <div data-route-error><ErrorState msg={updated ? routeRecovery.updated : routeRecovery.failed(error.message)} onRetry={() => updated ? window.location.reload() : this.setState({ error: null })} /></div>;
  }
}
