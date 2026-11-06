import type { MouseEvent } from 'react';
import { DEMO_EXTRAS } from '../auth-mode';

export type ExternalSystem = 'codebeamer' | 'jira';
/** 독립 시연 창 — GitLab은 MR 열람 창(쓰기 없음)이라 JIRA·codeBeamer 공용 작업 화면과 따로 그린다 */
export type ExternalWindow = ExternalSystem | 'gitlab';
export const GITHUB_PR_URL = 'https://github.com/mutuuslab/feature-topology-platform/pull/9';
export const EXTERNAL_CHANGE_KEY = 'ff.external.changed';

export function externalUrl(system: ExternalWindow, key?: string, role?: string, feature?: string) {
  const query = new URLSearchParams({ system });
  if (key) query.set('key', key);
  if (feature) query.set('feature', feature);
  if (role) query.set('role', role);
  return `/external.html?${query}`;
}

export function isDemoReference(system: string, url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      ((system === 'JIRA' && parsed.hostname === 'jira.ff.example') || (system === 'CODEBEAMER' && parsed.hostname === 'codebeamer.ff.example') || (system === 'GITLAB' && parsed.hostname === 'gitlab.ff.example'));
  } catch { return false; }
}

const WINDOW: Record<string, ExternalWindow> = { JIRA: 'jira', CODEBEAMER: 'codebeamer', GITLAB: 'gitlab' };

/** 고객이 설정한 URL은 그대로 유지한다. 예약된 데모 호스트만 독립 시연 창으로 바꾼다. 연결 대상 Feature(entityId)는 GitLab 창이 원장으로 다시 확인한다. */
export function externalReferenceUrl(ref: { system: string; url: string; key: string; entityId?: string }, demo = DEMO_EXTRAS, role?: string) {
  const feature = ref.system === 'GITLAB' && /^FEAT-\d{5}@\d+\.\d+\.\d+$/.test(ref.entityId ?? '') ? ref.entityId : undefined;
  return demo && isDemoReference(ref.system, ref.url) ? externalUrl(WINDOW[ref.system], ref.key, role, feature) : ref.url;
}

/** 사용자 클릭 중에 호출하므로 팝업 차단을 피한다. noopener의 null 반환에 재시도하면 창이 두 개 열린다. */
export function openExternalWindow(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.open(event.currentTarget.href, '_blank', 'popup=yes,noopener,noreferrer,width=1366,height=900');
}

export function announceExternalChange(system: ExternalSystem, key: string) {
  try { localStorage.setItem(EXTERNAL_CHANGE_KEY, JSON.stringify({ system, key, nonce: crypto.randomUUID() })); } catch { /* 저장소 제한이 있어도 서버의 변경은 유지된다. */ }
}
