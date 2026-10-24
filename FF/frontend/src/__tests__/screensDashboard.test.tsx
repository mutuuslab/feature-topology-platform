// 내 대시보드 — Jira(Atlassian) 대시보드: 시스템 대시보드(역할별)·보기 모드(손잡이 없음)·편집 모드(띠·레이아웃·점선 열·디렉터리)·
// 가젯 인스턴스 추가·구성·저장, 키보드 이동(끌기 대안)·aria-live·초점, 공유, 412 겹친 저장, v1 옮기기, 정적 데모 저장소 규칙. 모의 API(메모리 서버).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { HomeScreen } from '../screens/home/Inbox';
import { systemBoard } from '../screens/home/dashboard/catalog';
import { V1_KEY } from '../screens/home/dashboard/layout';
import { localBackend } from '../screens/home/dashboard/store';

interface Saved {
  id: string;
  name: string;
  ownerId: string;
  sharedRoles: string[];
  version: number;
  board: unknown;
  favourite: boolean;
}
let db: Saved[] = [];
let calls: { method: string; url: string; body: any; ifMatch: string | null }[] = [];
let conflictNext = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const view = (d: Saved, me: string) => ({ ...d, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', mine: d.ownerId === me });

beforeEach(() => {
  localStorage.clear();
  db = [];
  calls = [];
  conflictNext = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const h = (init?.headers ?? {}) as Record<string, string>;
      const me = h['X-Actor-Id'] ?? 'anonymous';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.startsWith('/api/dashboards')) {
        calls.push({ method, url, body, ifMatch: h['If-Match'] ?? null });
        const id = url.split('/')[3];
        if (method === 'GET') return json({ items: db.filter((d) => d.ownerId === me || d.sharedRoles.includes(h['X-Actor-Role'])).map((d) => view(d, me)) });
        if (method === 'POST') {
          const d: Saved = { id: `DSH-${db.length + 1}`, name: body.name, ownerId: me, sharedRoles: body.sharedRoles ?? [], version: 1, board: body.board, favourite: false };
          db.push(d);
          return json(view(d, me), 201);
        }
        const d = db.find((x) => x.id === id);
        if (!d) return json({ error: { code: 'NOT_FOUND', message: '없음' } }, 404);
        if (url.endsWith('/favourite')) {
          d.favourite = body.favourite;
          return json(view(d, me));
        }
        if (conflictNext || h['If-Match'] !== `"${d.version}"`) {
          conflictNext = false;
          return json({ error: { code: 'PRECONDITION_FAILED', message: '다른 곳에서 이 대시보드가 바뀌었습니다. 최신 판을 다시 불러와 주세요.', details: { version: d.version } } }, 412);
        }
        if (method === 'DELETE') {
          db = db.filter((x) => x !== d);
          return json({ id, deleted: true });
        }
        Object.assign(d, { ...body, version: d.version + 1 });
        return json(view(d, me));
      }
      return json({ items: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role = 'operator') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>
          <HomeScreen />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const columns = () => [...document.querySelectorAll('.jd-col')].map((c) => [...c.querySelectorAll(':scope > [data-gadget]')].map((g) => g.getAttribute('data-gadget')));
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;
const gadgetMenu = (title: string) => fireEvent.click(screen.getByRole('button', { name: `${title} 가젯 메뉴` }));
const live = () => document.querySelector('.jd [aria-live="polite"].ds-sr')!.textContent;

async function enterEdit() {
  fireEvent.click(screen.getByRole('button', { name: /편집/ }));
  await screen.findByRole('region', { name: '대시보드 편집 중' });
}

describe('내 대시보드 — Jira 대시보드', () => {
  it('처음에는 역할의 시스템 대시보드 — 이름(H1)·시스템 기본 표시, 보기 모드는 손잡이 없는 카드, 핵심 메시지는 하나', async () => {
    mount('operator');
    expect(h1()).toBe('내 대시보드');
    expect(screen.getByText('시스템 기본')).toBeTruthy();
    expect(columns()).toEqual(systemBoard('operator').columns);
    expect(document.querySelector('.jd').getAttribute('data-mode')).toBe('view');
    expect(document.querySelectorAll('.jd-grip')).toHaveLength(0);
    expect(document.querySelector('.jd-gadget__head[draggable="true"]')).toBeNull();
    expect(document.querySelectorAll('[data-key-message]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '내 대시보드 즐겨찾기에 추가' })).toBeTruthy();
    // 가젯 본문은 필요할 때 읽는다 — 읽고 나면 보인다
    expect(await screen.findByText('필터 결과: 이상 건')).toBeTruthy();
  });

  it('보기 모드 가젯 메뉴 — 새로 고침·최소화·최대화(시스템 판에는 구성·삭제 없음), 최대화는 그 가젯만 넓게', async () => {
    mount('operator');
    gadgetMenu('운영 요약');
    const menu = screen.getByRole('menu', { name: '운영 요약 가젯 메뉴' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['새로 고침', '최소화', '최대화']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '최소화' }));
    expect(document.querySelector('[data-gadget="summary"] .jd-gadget__body')).toBeNull();
    gadgetMenu('운영 요약');
    fireEvent.click(screen.getByRole('menuitem', { name: '펼치기' }));
    expect(document.querySelector('[data-gadget="summary"] .jd-gadget__body')).not.toBeNull();
    gadgetMenu('운영 요약');
    fireEvent.click(screen.getByRole('menuitem', { name: '최대화' }));
    expect(document.querySelectorAll('[data-gadget]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '대시보드로 돌아가기' }));
    expect(columns()).toEqual(systemBoard('operator').columns);
  });

  it('메뉴는 키보드로 — 화살표로 옮기고 Escape로 닫으면 단추로 초점이 돌아간다', () => {
    mount('operator');
    const btn = screen.getByRole('button', { name: '바로 가기 가젯 메뉴' });
    fireEvent.click(btn);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  // 회귀(2026-10-24, e2e 키보드 이동): 화면 아래쪽 가젯의 메뉴를 열면 첫 항목에 초점을 주면서 화면이 굴렀고,
  // 그 스크롤이 "화면이 움직이면 닫기"를 불러 초점을 돌려주지 않고 닫아 초점이 사라졌다
  it('메뉴를 열 때 첫 항목 초점은 화면을 굴리지 않고, 스크롤로 닫혀도 초점은 단추로 돌아간다', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    mount('operator');
    const btn = screen.getByRole('button', { name: '바로 가기 가젯 메뉴' });
    fireEvent.click(btn);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    const call = focus.mock.contexts.indexOf(items[0]);
    expect(call).toBeGreaterThanOrEqual(0);
    expect(focus.mock.calls[call][0]).toMatchObject({ preventScroll: true });
    fireEvent.scroll(document);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    focus.mockRestore();
  });

  it('시스템 대시보드를 편집하면 내 사본을 서버에 만들고 편집 모드 — 띠·레이아웃 썸네일·점선 열·디렉터리·손잡이', async () => {
    mount('operator');
    await enterEdit();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: '내 대시보드 사본', sharedRoles: [] });
    expect(h1()).toBe('내 대시보드 사본');
    expect(document.querySelector('.jd').getAttribute('data-mode')).toBe('edit');
    expect(screen.getByRole('radiogroup', { name: '레이아웃' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['1열', '2열 같은 폭', '2열 왼쪽 넓게', '2열 오른쪽 넓게', '3열']);
    expect(await screen.findByRole('complementary', { name: '가젯 추가' })).toBeTruthy();
    expect(document.querySelectorAll('.jd-grip').length).toBe(systemBoard('operator').columns.flat().length);
    expect(live()).toMatch(/사본 '내 대시보드 사본'을 만들어/);
  });

  // 회귀(2026-10-25 CI 메뉴 초점 경합): 편집 모드에 들어가면 '편집 중' 제목(다음 그림 틀)과 디렉터리 검색 칸(지연 묶음이 읽힌 뒤)이
  // 서로 초점을 가져가 마지막 자리가 묶음 읽는 속도에 따라 달랐다 — 그 사이 사용자가 옮긴 초점도 빼앗겼다. 초점은 제목 하나로 정한다
  it('편집 모드 진입 초점은 언제나 편집 중 제목 — 함께 열리는 디렉터리는 검색 칸으로 초점을 가져가지 않는다(단추로 열 때만)', async () => {
    mount('operator');
    await enterEdit();
    await screen.findByRole('complementary', { name: '가젯 추가' });
    await waitFor(() => expect(document.activeElement?.id).toBe('jd-editbar-h'));
    // 디렉터리 묶음이 늦게 읽혀도(이미 읽혔어도) 제목 초점은 그대로
    await new Promise((r) => requestAnimationFrame(() => r(null))); // hygiene-ok: 다음 그림 틀 한 번 — 늦은 초점 이동이 끝난 뒤를 본다
    expect(document.activeElement?.id).toBe('jd-editbar-h');
    // 사용자가 '가젯 추가'로 디렉터리를 다시 열면 검색 칸으로
    fireEvent.click(screen.getByRole('button', { name: /가젯 추가/, pressed: true }));
    fireEvent.click(screen.getByRole('button', { name: /가젯 추가/, pressed: false }));
    await waitFor(() => expect((document.activeElement as HTMLInputElement | null)?.type).toBe('search'));
  });

  it('가젯 추가 → 가젯 안 구성 양식 → 저장하면 보기 상태, 같은 종류를 설정만 달리해 또 추가', async () => {
    mount('operator');
    await enterEdit();
    const dir = await screen.findByRole('complementary', { name: '가젯 추가' });
    fireEvent.click(within(dir).getByRole('button', { name: '필터 결과 추가' }));
    const form = await screen.findByRole('form', { name: '필터 결과 구성' });
    expect(columns()[0][0]).toMatch(/^filter-/);
    expect(live()).toMatch(/필터 결과: Feature 가젯을 첫 열 맨 위에 추가했습니다/);
    fireEvent.change(within(form).getByLabelText('데이터'), { target: { value: 'policies' } });
    fireEvent.change(within(form).getByRole('combobox', { name: '상태' }), { target: { value: 'VALIDATED' } });
    fireEvent.change(within(form).getByLabelText('자동 새로 고침'), { target: { value: '5' } });
    fireEvent.click(within(form).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: '필터 결과 구성' })).toBeNull());
    const id = columns()[0][0]!;
    await waitFor(() => {
      const last = calls.filter((c) => c.method === 'PUT').at(-1)!;
      expect(last.body.board.gadgets[id]).toMatchObject({ type: 'filter', configured: true, refresh: 5, config: { source: 'policies', status: 'VALIDATED' } });
    });
    expect(screen.getByRole('heading', { name: '필터 결과: 배포 정책' })).toBeTruthy();
    // 같은 종류를 또 — 다른 인스턴스
    fireEvent.click(within(dir).getByRole('button', { name: '필터 결과 추가' }));
    await screen.findByRole('form', { name: '필터 결과 구성' });
    // 시스템 판의 필터 결과 1 + 방금 둘
    expect(columns()[0].filter((x) => x?.startsWith('filter-'))).toHaveLength(3);
    expect(within(dir).getByText('이 대시보드에 3개')).toBeTruthy();
  });

  it('추가 취소는 그 가젯을 뺀다 · 구성은 메뉴로 다시 연다', async () => {
    mount('operator');
    await enterEdit();
    const dir = await screen.findByRole('complementary', { name: '가젯 추가' });
    const pies = () => columns().flat().filter((x) => x?.startsWith('pie-')).length;
    const before = pies();
    fireEvent.click(within(dir).getByRole('button', { name: '통계 원형 차트 추가' }));
    const form = await screen.findByRole('form', { name: '통계 원형 차트 구성' });
    expect(pies()).toBe(before + 1);
    fireEvent.click(within(form).getByRole('button', { name: '추가 취소' }));
    expect(pies()).toBe(before);
    gadgetMenu('운영 요약');
    fireEvent.click(screen.getByRole('menuitem', { name: '구성' }));
    const again = await screen.findByRole('form', { name: '운영 요약 구성' });
    fireEvent.change(within(again).getByLabelText('가젯 제목'), { target: { value: '오늘 운영' } });
    fireEvent.click(within(again).getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('heading', { name: '오늘 운영' })).toBeTruthy();
  });

  it('키보드 이동(끌기 대안) — 가젯 메뉴로 다른 열로 옮기고 바뀐 자리를 알린다, 끝에서는 막힌다', async () => {
    mount('operator');
    await enterEdit();
    gadgetMenu('바로 가기');
    fireEvent.click(screen.getByRole('menuitem', { name: '왼쪽 열로 이동' }));
    expect(columns()[0]).toContain('links');
    expect(live()).toMatch(/바로 가기 — 1열 \d번째로 옮겼습니다/);
    gadgetMenu('바로 가기');
    expect(screen.getByRole('menuitem', { name: '왼쪽 열로 이동' })).toBeDisabled();
  });

  it('레이아웃 썸네일 — 3열로 바꾸고 1열로 줄여도 가젯을 잃지 않는다', async () => {
    mount('operator');
    await enterEdit();
    fireEvent.click(screen.getByRole('radio', { name: '3열' }));
    expect(columns()).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: '1열' }));
    expect(columns()).toHaveLength(1);
    expect([...columns()[0]].sort()).toEqual([...systemBoard('operator').columns.flat()].sort());
  });

  it('끌어 놓기 — 편집 모드에서 제목 줄을 끌어 다른 열에 놓는다(정확한 자리는 실제 브라우저 e2e)', async () => {
    mount('operator');
    await enterEdit();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', get types() { return [...data.keys()]; }, setDragImage: () => undefined, effectAllowed: '', dropEffect: '' };
    const head = document.querySelector('[data-gadget="links"] .jd-gadget__head')!;
    const col0 = document.querySelectorAll('.jd-col')[0];
    fireEvent.dragStart(head, { dataTransfer });
    fireEvent.dragOver(col0, { dataTransfer });
    expect(document.querySelector('.jd-drop')).not.toBeNull();
    fireEvent.drop(col0, { dataTransfer });
    expect(columns()[0].at(-1)).toBe('links');
    expect(document.querySelector('.jd-drop')).toBeNull();
  });

  it('완료 — 보기 모드로 돌아가 손잡이가 사라지고 편집 단추로 초점이 돌아간다', async () => {
    mount('operator');
    await enterEdit();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(document.querySelector('.jd').getAttribute('data-mode')).toBe('view');
    expect(document.querySelectorAll('.jd-grip')).toHaveLength(0);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-ui')).toBe('dashboard-edit'));
  });

  // 회귀(2026-10-25, e2e 편집 초점 3건): 사본을 만든 뒤 편집 띠가 그려지기 전에 다음 그림 틀(requestAnimationFrame)이 먼저 오면
  // 초점을 줄 '편집 중' 제목이 아직 없어 초점이 본문으로 사라졌다. 그림 틀이 곧바로 오는 경우로 재현한다
  it('편집 모드 초점은 편집 띠가 그려진 뒤에 준다 — 그림 틀이 먼저 와도 \'편집 중\' 제목에 초점, 완료하면 편집 단추로', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0));
    mount('operator');
    await enterEdit();
    await waitFor(() => expect(document.activeElement?.id).toBe('jd-editbar-h'));
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-ui')).toBe('dashboard-edit'));
  });

  it('공유 — 고른 역할을 서버에 저장한다(소유자만)', async () => {
    mount('operator');
    await enterEdit();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    fireEvent.click(screen.getByRole('button', { name: '대시보드 더 보기' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '공유' }));
    const dlg = await screen.findByRole('dialog', { name: "'내 대시보드 사본' 공유" });
    fireEvent.click(within(dlg).getByLabelText('운영·감사 조회자'));
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toMatchObject({ sharedRoles: ['AUDITOR'] }));
    expect(await screen.findByText(/공유: 운영·감사 조회자/)).toBeTruthy();
  });

  it('겹친 저장(412) — 오류를 알리고 서버 판을 다시 읽는다(덮어쓰지 않는다)', async () => {
    mount('operator');
    await enterEdit();
    const before = calls.filter((c) => c.method === 'GET').length;
    conflictNext = true;
    fireEvent.click(screen.getByRole('radio', { name: '3열' }));
    expect(await screen.findByText('다른 곳에서 이 대시보드가 바뀌었습니다. 최신 판을 다시 불러와 주세요.')).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before));
    // 낙관적으로 바꾼 3열을 버리고 서버 판(2열)으로
    await waitFor(() => expect(columns()).toHaveLength(2));
  });

  it('바꾸기 메뉴 — 내가 만든 대시보드와 시스템 대시보드를 오가고, 마지막으로 연 판을 기억한다', async () => {
    mount('operator');
    await enterEdit();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    fireEvent.click(screen.getByRole('button', { name: '대시보드 바꾸기' }));
    const menu = screen.getByRole('menu', { name: '대시보드 바꾸기' });
    expect(within(menu).getByRole('group', { name: '내가 만든 대시보드' })).toBeTruthy();
    fireEvent.click(within(within(menu).getByRole('group', { name: '시스템 대시보드' })).getByRole('menuitemradio'));
    expect(h1()).toBe('내 대시보드');
    cleanup();
    mount('operator');
    expect(h1()).toBe('내 대시보드');
  });

  it('옛 판(v1)은 처음 한 번 내 대시보드로 옮기고 v1을 지운다', async () => {
    localStorage.setItem(V1_KEY('operator'), JSON.stringify({ v: 1, layout: '3', columns: [['kills'], ['summary'], ['links']], collapsed: [] }));
    mount('operator');
    await waitFor(() => expect(h1()).toBe('내 대시보드 (이전 배치)'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(localStorage.getItem(V1_KEY('operator'))).toBeNull();
    expect(columns()).toEqual([['kills'], ['summary'], ['links']]);
    cleanup();
    mount('operator');
    await waitFor(() => expect(h1()).toBe('내 대시보드 (이전 배치)'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('정적 데모 저장소(백엔드 없음) — 서버와 같은 규칙', () => {
  beforeEach(() => localStorage.clear());
  const board = systemBoard('viewer');

  it('소유자만 바꾸고, 역할 공유는 보기만, 버전이 다르면 412', async () => {
    const author = localBackend({ id: 'usr-author', roles: ['FEATURE_AUTHOR'] });
    const viewer = localBackend({ id: 'usr-viewer', roles: ['AUDITOR'] });
    const d = await author.create({ name: '공유 판', board, sharedRoles: [] });
    expect(await viewer.list()).toEqual([]);
    const s = await author.update(d.id, 1, { sharedRoles: ['AUDITOR'] });
    expect(s.version).toBe(2);
    const seen = await viewer.list();
    expect(seen.map((x) => [x.id, x.mine])).toEqual([[d.id, false]]);
    await expect(viewer.update(d.id, 2, { name: '가로채기' })).rejects.toMatchObject({ status: 403 });
    await expect(author.update(d.id, 1, { name: '옛 버전' })).rejects.toMatchObject({ status: 412 });
    // 별은 보는 사람별
    await viewer.favourite(d.id, true);
    expect((await viewer.list())[0].favourite).toBe(true);
    expect((await author.list())[0].favourite).toBe(false);
    await author.remove(d.id, 2);
    expect(await viewer.list()).toEqual([]);
  });

  it('다른 역할이 공유받은 판을 보게 된다 — 같은 브라우저의 다른 계정', async () => {
    const op = localBackend({ id: 'usr-operator', roles: ['OPERATOR'] });
    await op.create({ name: '운영 판', board, sharedRoles: ['AUDITOR', 'SAFETY_OFFICER'] });
    const quality = localBackend({ id: 'usr-quality', roles: ['GATE_JUDGE', 'SAFETY_OFFICER'] });
    expect((await quality.list()).map((x) => x.name)).toEqual(['운영 판']);
    await act(async () => undefined);
  });
});
