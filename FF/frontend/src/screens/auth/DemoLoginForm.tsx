// 데모 로그인 폼 — 데모 빌드에서만 실린다(운영 빌드는 SsoLoginForm). 아이디·비밀번호는 데모 고정값(auth-demo.ts).
// 담당 부서(부서 보기, 2026-11-04)는 기본이 전체 보기 — 고르면 그 부서의 작업공간으로 들어간다. 상단 바에서 언제든 바꾼다.
// 정적 사이트(공개 데모)는 서버 접속 게이트(/__auth/login)에 확인받고, 게이트가 보낸 ?next=(원래 가려던 주소)로 돌아간다.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEMO_LOGIN_MARKER, login as authLogin, loginWithServer, staticSite } from '../../auth-demo';
import { login as L } from '../../copy/login';
import { Button } from '../../design';
import { departments as D } from '../../copy/departments';
import { ALL_DEPARTMENTS } from '../../data/departments';
import { DepartmentSelect } from '../../shell/DepartmentSwitcher';
import { useAppApi, useAppShell } from '../../store';

export function DemoLoginForm({ from }: { from?: string }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const { department } = useAppShell();
  const { dispatch } = useAppApi();
  const [dept, setDept] = useState(department || ALL_DEPARTMENTS);

  // back: 돌아갈 곳 — 화면 안 이동(state.from)이 먼저, 정적 사이트는 없으면 서버 게이트가 붙인 ?next=.
  // ?next=는 문서를 새로 연다(hard) — SPA 밖 페이지(external.html → Pages가 /external로 바꾼다)도 있어서다
  const enter = (ok: boolean, back = from, hard = false) => {
    if (!ok) {
      setErr(true);
      return;
    }
    dispatch({ t: 'DEPT', department: dept });
    // 부서를 골랐으면 그 부서의 작업공간(홈)으로 — 전체 보기는 원래 가려던 화면으로
    const to = dept === ALL_DEPARTMENTS && back && back !== '/login' ? back : '/';
    if (hard && to === back) window.location.assign(to);
    else nav(to, { replace: true });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    // 플랫폼(백엔드)이 있으면 서버 게이트(FF_DEMO_GATE, 20-99)에 먼저 묻는다 — 게이트가 없으면 브라우저 판정(auth-demo.ts)
    if (!staticSite()) {
      void loginWithServer(id, pw).then((ok) => {
        setBusy(false);
        enter(ok);
      });
      return;
    }
    void import('../../auth-gate').then(
      async (g) => {
        const ok = await g.gateLogin(id, pw);
        setBusy(false);
        const next = from ? undefined : g.safeNextPath(new URLSearchParams(loc.search).get('next'));
        enter(ok, from ?? next, next !== undefined);
      },
      () => {
        // 게이트 모듈을 못 받으면(배포 교체 중 등) 기존 브라우저 로그인으로
        setBusy(false);
        enter(authLogin(id, pw));
      },
    );
  };

  return (
    <form className="lg__card" onSubmit={submit} noValidate data-demo-login={DEMO_LOGIN_MARKER}>
      <header className="lg__card-head">
        <h2>{L.formTitle}</h2>
      </header>
      <label className="lg__field">
        <span>{L.id}</span>
        <input
          className="ds-input ds-input--mono"
          name="username"
          autoComplete="username"
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoFocus
          aria-invalid={err || undefined}
        />
      </label>
      <label className="lg__field">
        <span>{L.password}</span>
        <span className="lg__pw">
          <input
            className="ds-input ds-input--mono"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-invalid={err || undefined}
          />
          <button type="button" className="lg__show" onClick={() => setShow(!show)} aria-label={show ? L.hide : L.show}>
            {show ? L.hide : L.show}
          </button>
        </span>
      </label>
      {/* 한 줄(이름 | 선택) — 큰 화면에서 로그인 폼이 화면 높이를 넘지 않게. 설명은 말풍선으로 */}
      <label className="lg__field lg__field--inline" title={D.login.hint}>
        <span>{D.login.label}</span>
        <DepartmentSelect value={dept} onChange={setDept} label={D.login.label} />
      </label>
      {err && (
        <p className="lg__error" role="alert">
          {L.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="lg__submit" disabled={busy} aria-busy={busy || undefined}>
        {busy ? L.submitting : L.submit}
      </Button>
    </form>
  );
}
