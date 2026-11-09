import './zod-config'; // 맨 먼저 — CSP 아래 zod eval 떠보기 끔
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { isLocalFile } from './file-routing';
import { AppProvider } from './store';
import { DeferredTwinProvider } from './state/DeferredTwinProvider';
import { MotionProvider } from './state/motion';
import { ToastHost } from './components/patterns';
import { CommandPalette } from './shell/CommandPalette';
import { configureErrorActions } from './design'; // 토큰·폰트·디자인 키트 (레거시 styles.css보다 먼저)
import { relogin } from './auth';
import { shouldRetry } from './api/errors';
import { STATIC_MODE } from './api/client';
import { onLocalDataChange } from './api/shared-event-source';
import './styles.css';
import './design/legacy-bridge.css'; // 레거시 화면을 새 체계로 (styles.css 다음)

// 서버 상태 캐시 — 거버넌스 데이터는 자주 바뀌지 않으므로 30초간 신선한 것으로 본다
// 다시 시도는 연결 끊김·서버 오류만 한 번 — 401·403·409·입력 오류는 다시 보내도 같다(RD-UX-01)
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: (n, e) => n < 1 && shouldRetry(e), refetchOnWindowFocus: false } } });

// 오류 안내의 다음 행동 — 다시 로그인, 최신 내용 다시 불러오기(서버 상태만 다시 읽고 화면 입력은 그대로)
configureErrorActions({ relogin, reload: () => queryClient.invalidateQueries() });
// 공개 시연 사이트 — 이 브라우저의 시연 데이터가 바뀌면 화면 조회를 새로 읽는다(보이는 것만 바로, 나머지는 다음에 열 때 — 20-60)
if (STATIC_MODE) onLocalDataChange(() => void queryClient.invalidateQueries());

const Router = isLocalFile() ? HashRouter : BrowserRouter;
const routerBase = isLocalFile() ? undefined : import.meta.env.BASE_URL;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <Router basename={routerBase}>
      <MotionProvider>
        <AppProvider>
          <DeferredTwinProvider>
            <App />
            <CommandPalette />
            <ToastHost />
          </DeferredTwinProvider>
        </AppProvider>
      </MotionProvider>
    </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
