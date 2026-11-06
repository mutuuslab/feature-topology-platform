// 데모 로그인 폼 — 데모 빌드에서만 실린다(운영 빌드는 SsoLoginForm). 아이디·비밀번호는 데모 고정값(auth-demo.ts).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_LOGIN_MARKER, login as authLogin } from '../../auth-demo';
import { login as L } from '../../copy/login';
import { Button } from '../../design';

export function DemoLoginForm({ from }: { from?: string }) {
  const nav = useNavigate();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authLogin(id, pw)) {
      setErr(true);
      return;
    }
    nav(from && from !== '/login' ? from : '/', { replace: true });
  };

  return (
    <form className="lg__card" onSubmit={submit} noValidate data-demo-login={DEMO_LOGIN_MARKER}>
      <h2>{L.formTitle}</h2>
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
      {err && (
        <p className="lg__error" role="alert">
          {L.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="lg__submit">
        {L.submit}
      </Button>
    </form>
  );
}
