import { Component, type ReactNode } from 'react';
import { ErrorState } from './patterns';

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
    return <ErrorState msg={`화면을 표시할 수 없습니다: ${error.message}`} onRetry={() => this.setState({ error: null })} />;
  }
}
