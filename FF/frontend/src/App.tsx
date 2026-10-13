// 앱 루트 — 셸(MENU 2.0) + routes.tsx의 라우트. 화면·메뉴 구성은 routes.tsx 한 곳에서 바꾼다.
import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { NotFound } from './components/patterns';
import RouteBoundary from './components/RouteBoundary';
import { ROUTES } from './routes';
import { Shell } from './shell/Shell';
import { roleHome, useAppShell } from './store';

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const { role } = useAppShell();
  // 최초 진입 시 현재 역할의 기본 화면으로 (이후 '내 대시보드'는 메뉴로 이동)
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (loc.pathname === '/') nav(roleHome[role] || '/features', { replace: true });
  }, []);

  return (
    <Shell>
      <RouteBoundary key={loc.pathname}>
        <Routes>
          {ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={<r.element />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </RouteBoundary>
    </Shell>
  );
}
