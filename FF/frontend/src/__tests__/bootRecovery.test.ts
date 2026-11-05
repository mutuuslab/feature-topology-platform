import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

const frontend = join(__dirname, '../..');
const entry = readFileSync(join(frontend, 'index.html'), 'utf8');
const boot = readFileSync(join(frontend, 'public/boot-check.js'), 'utf8');
const recovery = readFileSync(join(frontend, 'public/recovery.html'), 'utf8');
const reset = readFileSync(join(frontend, 'public/recovery.js'), 'utf8');
const opened: JSDOM[] = [];
const page = (html: string, path = '/feature-topology-platform/') => {
  const dom = new JSDOM(html.replaceAll('%BASE_URL%', '/feature-topology-platform/'), { url: `https://platform.test${path}`, runScripts: 'outside-only' });
  opened.push(dom);
  return dom;
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { opened.splice(0).forEach((dom) => dom.window.close()); vi.restoreAllMocks(); });

describe('React와 분리된 화면 복구', () => {
  it('JS가 실행되지 않아도 복구 안내가 root 바깥에 있고 공개 배포 BASE 경로를 따른다', () => {
    const { document } = page(entry).window;
    const box = document.getElementById('boot-recovery') as HTMLElement;
    expect(box.hidden).toBe(false);
    expect(document.getElementById('root')?.contains(box)).toBe(false);
    expect(box.querySelector('a')?.href).toBe('https://platform.test/feature-topology-platform/recovery.html');
    expect(document.querySelector<HTMLScriptElement>('script[src$="boot-check.js"]')?.src).toBe('https://platform.test/feature-topology-platform/boot-check.js');
    expect([...document.scripts].every((script) => !!script.src)).toBe(true);
  });

  it('정상 마운트에서는 숨기고 React가 root를 지운 뒤에는 다시 보인다', async () => {
    const { window } = page(entry), root = window.document.getElementById('root')!;
    window.eval(boot);
    const box = window.document.getElementById('boot-recovery') as HTMLElement;
    root.innerHTML = '<main><h1>정상 화면</h1></main>';
    await flush();
    expect(box.hidden).toBe(true);
    expect(window.document.querySelectorAll('h1')).toHaveLength(1);
    root.replaceChildren();
    await flush();
    expect(box.hidden).toBe(false);
  });

  it('초기화가 진행되지 않으면 시간 제한 뒤에도 복구 안내가 남는다', () => {
    const { window } = page(entry);
    let timedOut: (() => void) | undefined;
    vi.spyOn(window, 'setTimeout').mockImplementation((callback) => { timedOut = callback as () => void; return 1; });
    window.eval(boot);
    timedOut!();
    expect(window.document.getElementById('boot-state')?.textContent).toContain('시작하지 못했습니다');
    expect((window.document.getElementById('boot-recovery') as HTMLElement).hidden).toBe(false);
  });

  it('스크립트 오류에서 안전한 종류·정적 파일명만 표시하고 토큰·업무값·전체 URL을 싣지 않는다', async () => {
    const { window } = page(entry);
    window.eval(boot);
    window.dispatchEvent(new window.ErrorEvent('error', { filename: 'https://private.test/assets/main-Abc123.js?token=secret-token', message: 'VIN-PRIVATE secret-token', error: new window.TypeError('VIN-PRIVATE secret-token') }));
    expect(window.document.getElementById('boot-detail')?.textContent).toBe('TypeError · main-Abc123.js');
    expect(window.document.body.textContent).not.toMatch(/secret-token|VIN-PRIVATE|private\.test/);
    const rejection = new window.Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: { name: 'VIN-PRIVATE secret-token', message: 'business data' } });
    window.dispatchEvent(rejection);
    expect(window.document.getElementById('boot-detail')?.textContent).toBe('초기화 오류');
    window.document.getElementById('root')!.innerHTML = '<main>정상 화면</main>';
    await flush();
    expect((window.document.getElementById('boot-recovery') as HTMLElement).hidden).toBe(true);
  });

  it('설명한 UI 세 키만 사용자 클릭 때 지우고 로그인·다른 저장값·업무 연결은 보존한다', () => {
    const { window } = page(recovery, '/feature-topology-platform/recovery.html');
    const ui = ['fp.state.v2', 'fp.twin.v1', 'ff.learn.v1'];
    ui.forEach((key) => window.localStorage.setItem(key, 'malformed UI'));
    window.localStorage.setItem('login-token', 'keep-local-auth');
    window.localStorage.setItem('ff.auth', '1');
    window.localStorage.setItem('other-app-state', 'keep-other');
    window.sessionStorage.setItem('oidc-session', 'keep-session-auth');
    window.document.cookie = 'session=keep-cookie';
    const fetch = vi.fn();
    Object.defineProperty(window, 'fetch', { value: fetch });
    const deleteDatabase = vi.fn();
    Object.defineProperty(window, 'indexedDB', { value: { deleteDatabase } });
    window.eval(reset);
    expect(ui.every((key) => window.localStorage.getItem(key) === 'malformed UI')).toBe(true);
    expect(window.document.getElementById('reset-description')?.textContent).toContain('로그인 세션');
    (window.document.getElementById('reset-ui') as HTMLButtonElement).click();
    expect(ui.every((key) => window.localStorage.getItem(key) === null)).toBe(true);
    expect(window.localStorage.getItem('login-token')).toBe('keep-local-auth');
    expect(window.localStorage.getItem('ff.auth')).toBe('1');
    expect(window.localStorage.getItem('other-app-state')).toBe('keep-other');
    expect(window.sessionStorage.getItem('oidc-session')).toBe('keep-session-auth');
    expect(window.document.cookie).toBe('session=keep-cookie');
    expect(fetch).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(window.document.querySelector('a')?.href).toBe('https://platform.test/feature-topology-platform/');
  });

  it('저장소 접근이 거부되면 성공으로 안내하지 않는다', () => {
    const { window } = page(recovery);
    vi.spyOn(window.Storage.prototype, 'removeItem').mockImplementation(() => { throw new window.DOMException('private', 'SecurityError'); });
    window.eval(reset);
    (window.document.getElementById('reset-ui') as HTMLButtonElement).click();
    expect(window.document.getElementById('recovery-result')?.textContent).toContain('완료하지 못했습니다');
  });

  it('첫 화면 추가 스크립트는 1KiB gzip보다 작다', () => {
    expect(gzipSync(boot).length).toBeLessThan(1024);
  });
});
