import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AppProvider } from './store';
import { TwinProvider } from './state/twinStore';
import { MotionProvider } from './state/motion';
import { ToastHost } from './components/patterns';
import { CommandPalette } from './shell/CommandPalette';
import './design'; // 토큰·폰트·디자인 키트 (레거시 styles.css보다 먼저)
import './styles.css';
import './design/legacy-bridge.css'; // 레거시 화면을 새 체계로 (styles.css 다음)

// 서버 상태 캐시 — 거버넌스 데이터는 자주 바뀌지 않으므로 30초간 신선한 것으로 본다
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <MotionProvider>
        <AppProvider>
          <TwinProvider>
            <App />
            <CommandPalette />
            <ToastHost />
          </TwinProvider>
        </AppProvider>
      </MotionProvider>
    </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
