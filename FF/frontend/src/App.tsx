// 앱 루트 — 셸(MENU 2.0) + routes.tsx의 라우트. 화면·메뉴 구성은 routes.tsx 한 곳에서 바꾼다.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStatus } from './auth';
import { login as L } from './copy/login';
import { NotFound } from './components/patterns';
import RouteBoundary from './components/RouteBoundary';
import { ROUTES } from './routes';
import { LoginScreen } from './screens/auth/Login';
import { Shell } from './shell/Shell';

export default function App() {
  const loc = useLocation();
  const auth = useAuthStatus();

  // 로그인 화면은 셸 밖에서 그린다 — 이미 로그인했어도 /login은 항상 로그인 화면을 보여 준다
  // (세션이 남은 브라우저에서 로그인 화면이 '사라지는' 문제 방지). 로그인 성공 시 화면이 직접 이동한다.
  if (loc.pathname === '/login') return <LoginScreen />;
  // SSO(운영 빌드)는 서버에 로그인 상태를 묻는 동안 아무 화면도 그리지 않는다(로그인 화면 깜빡임 방지)
  if (auth === 'loading') return <main id="main" aria-busy="true" data-auth-loading>{L.sso.loading}</main>;
  if (auth !== 'authed') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

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
