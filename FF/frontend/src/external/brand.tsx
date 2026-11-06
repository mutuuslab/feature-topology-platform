// 외부 도구 공식 로고 — 받은 캡처에서 잘라 배경만 투명하게 만든 원본 크기 PNG(public/brand).
import type { ExternalSystem, ExternalWindow } from './links';

const LOGOS: Record<ExternalWindow, { src: string; alt: string; width: number; height: number }> = {
  codebeamer: { src: '/brand/codebeamer-logo.png', alt: 'codeBeamer', width: 130, height: 27 },
  jira: { src: '/brand/jira-logo.png', alt: 'Jira', width: 396, height: 156 },
  // GitLab 공식 tanuki(gitlab-org/gitlab의 app/views/shared/_logo.svg를 그대로) — 벡터라 크기를 바꿔도 흐려지지 않는다
  gitlab: { src: '/brand/gitlab-logo.svg', alt: 'GitLab', width: 25, height: 24 },
};

/** 시스템 이름 글자 옆에 함께 쓸 때는 decorative로 읽기를 한 번만 하게 한다. */
export function ExtBrandLogo({ system, height, decorative = false, className = '' }: { system: ExternalWindow; height: number; decorative?: boolean; className?: string }) {
  const logo = LOGOS[system];
  // codeBeamer 캡처는 원본 높이(27px)를 넘겨 키우지 않는다 — 확대하면 흐려진다.
  const h = system === 'codebeamer' ? Math.min(height, logo.height) : height;
  return <img className={('ext-brand-logo ' + className).trim()} data-system={system} src={logo.src} alt={decorative ? '' : logo.alt} width={Math.round((logo.width * h) / logo.height)} height={h} decoding="async" />;
}

/** 외부 연계 화면의 시스템 코드(CODEBEAMER·JIRA)를 로고 키로 바꾼다. */
export const brandSystem = (system: string): ExternalSystem | null => system === 'CODEBEAMER' ? 'codebeamer' : system === 'JIRA' ? 'jira' : null;
