// ISO/IEC 26580 제품 라인 하위 메뉴(20-60 §6) — Feature 카탈로그·Bill-of-Features·제품 구성기·공유 자산 추적을 오간다.
// Registry·상품 목록에도 붙인다(작은 모듈 — 화면 묶음은 따로 읽는다).
import { Link, useLocation } from 'react-router-dom';
import { pleNav as N } from '../../copy/ple';
import './ple.css';

const LINKS = [
  { to: '/features/catalogue', label: N.catalogue },
  { to: '/products/bill-of-features', label: N.bof },
  { to: '/products/configurator', label: N.configurator },
  { to: '/features/shared-assets', label: N.assets },
] as const;

export function PleNav() {
  const { pathname } = useLocation();
  return (
    <nav className="ple-nav" aria-label={N.label}>
      <span className="ple-nav__label" aria-hidden="true">
        {N.label}
      </span>
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} aria-current={pathname === l.to ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

