/**
 * §18 독립 Digital Twin 콘솔 엔트리 (twin.html).
 *
 * 플랫폼(`main.tsx`)과 동일한 Provider 트리를 쓰지만 셸은 전혀 다르다.
 *  - AppProvider : 역할·언어·감사 로그 (Feature Platform 과 동일한 AppState)
 *  - TwinProvider: DigitalTwinPort(MockTwinProvider) — 모든 수치의 단일 원천
 *  - TwinStandalone : 헤더 · 좌측 패널 · 중앙 뷰 · 우측 패널 · 하단 대시보드
 *
 * 라우터는 두지 않는다. 이 화면은 라우팅이 아니라 **뷰 스위처**로 동작하며,
 * 화면 이동은 플랫폼 URL 대신 내부 상태(view)로만 이루어진다.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './store';
import { TwinProvider } from './state/twinStore';
import { ToastHost } from './components/patterns';
import TwinStandalone from './pages/twinStandalone';
import './styles.css';
import './components/twinShell.css';

ReactDOM.createRoot(document.getElementById('twin-root')!).render(
  <React.StrictMode>
    <AppProvider>
      <TwinProvider>
        <TwinStandalone />
        <ToastHost />
      </TwinProvider>
    </AppProvider>
  </React.StrictMode>,
);
