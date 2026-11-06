// 오류 다음 행동(출시 준비 RD-UX-01) — ErrorNote(변경 실패)·AsyncView(조회 실패)가 오류 종류에 맞는 안내와 버튼을 같은 모양으로 보인다.
//   auth(401) 다시 로그인 · conflict(409/412) 최신 내용 불러오기(입력은 그대로) · validation 칸 고치기 안내 · server(5xx) 문의 번호
// 다시 로그인·다시 불러오기는 앱이 configureErrorActions로 넣는다(디자인 키트는 API·인증 모듈을 모른다). 넣지 않으면 버튼을 그리지 않는다.
// 안내·버튼 본체(error-next.tsx)는 필요할 때만 읽는다 — 첫 화면 묶음 예산. 연결 끊김(network)에는 다음 행동이 없어 읽지 않는다.
import { lazy, Suspense } from 'react';
import { errors as E } from '../copy/errors';

/** ApiError와 같은 모양(디자인 키트는 API 모듈을 가져오지 않는다) */
export interface ErrorLike {
  message: string;
  code?: string;
  details?: any;
  status?: number;
  kind?: string;
  correlationId?: string | null;
  retryAfterSec?: number | null;
}

export interface ErrorActions {
  /** 다시 로그인 — 지금 화면으로 돌아오는 로그인 */
  relogin?: () => void;
  /** 최신 내용 다시 불러오기 — 서버 상태만 다시 읽고 화면 입력은 건드리지 않는다 */
  reload?: () => Promise<unknown> | void;
}

let actions: ErrorActions = {};
/** 앱 시작 때 한 번 — main.tsx */
export function configureErrorActions(a: ErrorActions) {
  actions = { ...actions, ...a };
}
export const errorActions = () => actions;

/** 문자열 오류(옛 호출)와 객체 오류를 하나로 */
export const asErrorLike = (e: string | ErrorLike | null | undefined): ErrorLike | null => (e == null ? null : typeof e === 'string' ? { message: e } : e);

/** 사용자에게 보여 줄 만한 오류 코드인가 — 업무 규칙 코드는 보이고, 상태 코드 대용(HTTP_500)·연결·세션·서버 코드는 숨긴다 */
export const showsCode = (e: ErrorLike) => !!e.code && !/^(HTTP_|NETWORK|INTERNAL)/.test(e.code) && !/^(network|auth|server|rateLimit)$/.test(e.kind ?? '');

const TITLE: Record<string, string> = { auth: E.authTitle, conflict: E.conflictTitle, validation: E.validationTitle, rateLimit: E.rateLimitTitle, server: E.serverTitle };
/** 오류 종류 → 제목(조회 실패 상자) */
export const errorTitle = (e: ErrorLike | null, fallback: string): string => TITLE[e?.kind ?? ''] ?? fallback;

export const hasFieldDetails = (e: ErrorLike) => Array.isArray(e.details) || Array.isArray(e.details?.fields) || typeof e.details?.field === 'string';

/** 다음 행동이 있는 오류인가 */
const needsNext = (e: ErrorLike) => e.kind === 'conflict' || (e.kind === 'validation' && hasFieldDetails(e)) || (e.kind === 'server' && !!e.correlationId) || (e.kind === 'auth' && !!actions.relogin);

// 본체를 못 읽으면(배포 교체 중 등) 아무것도 그리지 않는다 — 오류 문장은 이미 보이고 있다
const Next = lazy(() => import('./error-next').catch(() => ({ default: () => null })));

/** 오류 아래 다음 행동 — 종류별 안내 한 줄과 버튼, 서버 오류의 문의 번호 */
export function ErrorNextStep({ error }: { error: ErrorLike | null | undefined }) {
  if (!error || !needsNext(error)) return null;
  return (
    <Suspense fallback={null}>
      <Next error={error} />
    </Suspense>
  );
}
