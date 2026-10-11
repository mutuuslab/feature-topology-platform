import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './store';
import { TwinProvider } from './state/twinStore';
import { MotionProvider } from './state/motion';
import { ToastHost } from './components/patterns';
import CommandPalette from './components/CommandPalette';
import './design'; // 토큰·폰트·디자인 키트 (레거시 styles.css보다 먼저)
import './styles.css';
import './design/legacy-bridge.css'; // 레거시 화면을 새 체계로 (styles.css 다음)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
