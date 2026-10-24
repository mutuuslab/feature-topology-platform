// 대시보드 판 모델 v2 — 가젯 인스턴스(같은 종류 여러 개)·구성·자동 새로 고침·최소화, 끌어 옮기기·메뉴 이동·레이아웃, v1 → v2 한 번 옮기기,
// 역할별 시스템 대시보드가 서버 검증 스키마(contracts DashboardBoard)를 통과하는지.
import { DashboardBoard } from '@ff/contracts';
import { GADGET_TYPES, gadgetTitle, systemBoard, TYPE_IDS } from '../screens/home/dashboard/catalog';
import {
  addGadget,
  clearV1,
  configureGadget,
  countOf,
  dropIndex,
  migrateV1,
  move,
  moveBy,
  normalize,
  placed,
  readV1,
  removeGadget,
  setLayout,
  setRefresh,
  toggleMinimized,
  V1_KEY,
  type Board,
  type Gadget,
} from '../screens/home/dashboard/layout';

const g = (id: string, type = 'filter'): Gadget => ({ id, type, config: {}, configured: true, refresh: 0, minimized: false });
const board = (layout: Board['layout'], columns: string[][]): Board => ({ v: 2, layout, columns, gadgets: Object.fromEntries(columns.flat().map((id) => [id, g(id)])) });
const base = board('2', [['a', 'b', 'c'], ['d']]);

describe('대시보드 판 모델 v2', () => {
  it('같은 종류를 설정만 달리해 여러 번 추가한다 — 새 인스턴스는 첫 열 맨 위, 구성 전 상태', () => {
    const one = addGadget(base, 'pie', { source: 'features', groupBy: 'lifecycle' });
    const two = addGadget(one.board, 'pie', { source: 'features', groupBy: 'asil' });
    expect(one.id).not.toBe(two.id);
    expect(two.board.columns[0].slice(0, 2)).toEqual([two.id, one.id]);
    expect(countOf(two.board, 'pie')).toBe(2);
    expect(two.board.gadgets[one.id]).toMatchObject({ type: 'pie', configured: false, refresh: 0, config: { groupBy: 'lifecycle' } });
    expect(two.board.gadgets[two.id].config.groupBy).toBe('asil');
    // 원본은 그대로(순수 함수)
    expect(placed(base)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('구성 저장 → 보기 상태, 자동 새로 고침·최소화는 인스턴스마다', () => {
    const { board: b, id } = addGadget(base, 'filter', { source: 'features' });
    const c = configureGadget(b, id, { source: 'anomalies', status: 'open', rows: 5 });
    expect(c.gadgets[id]).toMatchObject({ configured: true, config: { source: 'anomalies', status: 'open', rows: 5 } });
    const r = setRefresh(c, id, 5);
    expect(r.gadgets[id].refresh).toBe(5);
    expect(r.gadgets.a.refresh).toBe(0);
    expect(setRefresh(r, id, 5)).toBe(r);
    expect(toggleMinimized(r, 'a').gadgets.a.minimized).toBe(true);
    expect(toggleMinimized(toggleMinimized(r, 'a'), 'a').gadgets.a.minimized).toBe(false);
    const gone = removeGadget(r, id);
    expect(placed(gone)).not.toContain(id);
    expect(gone.gadgets[id]).toBeUndefined();
    expect(removeGadget(gone, 'zz')).toBe(gone);
  });

  it('같은 열에서 아래로 끌면 놓은 표시 자리에 들어간다(빠진 자리 보정) · 다른 열로 · 범위 밖은 열 끝', () => {
    expect(move(base, 'a', 0, 2).columns[0]).toEqual(['b', 'a', 'c']);
    expect(move(base, 'a', 0, 3).columns[0]).toEqual(['b', 'c', 'a']);
    expect(move(base, 'b', 1, 0).columns).toEqual([['a', 'c'], ['b', 'd']]);
    expect(move(base, 'b', 1, 99).columns[1]).toEqual(['d', 'b']);
    expect(move(base, 'b', 5, 0)).toBe(base);
  });

  it('메뉴 이동(끌기 대안) — 위·아래·왼쪽·오른쪽, 끝에서는 그대로', () => {
    expect(moveBy(base, 'b', 'up').columns[0]).toEqual(['b', 'a', 'c']);
    expect(moveBy(base, 'b', 'down').columns[0]).toEqual(['a', 'c', 'b']);
    expect(moveBy(base, 'a', 'up')).toBe(base);
    expect(moveBy(base, 'c', 'right').columns).toEqual([['a', 'b'], ['d', 'c']]);
    expect(moveBy(base, 'd', 'right')).toBe(base);
  });

  it('레이아웃 — 줄이면 넘친 열을 마지막 열 아래로, 늘리면 긴 열의 아래 가젯부터 나눈다, 2열↔2L↔2R은 그대로', () => {
    const three = board('3', [['a'], ['b'], ['c', 'd']]);
    expect(setLayout(three, '1').columns).toEqual([['a', 'b', 'c', 'd']]);
    const one = board('1', [['a', 'b', 'c', 'd', 'e']]);
    expect(setLayout(one, '3').columns).toEqual([['a', 'b'], ['c', 'e'], ['d']]);
    const two = board('2', [['a', 'b', 'c'], ['d', 'e']]);
    expect(setLayout(two, '3', { a: 600, b: 100, c: 100, d: 200, e: 200 }).columns).toEqual([['a'], ['d', 'e'], ['b', 'c']]);
    expect(setLayout(base, '2L').columns).toEqual(base.columns);
    expect(setLayout(base, '2R')).toMatchObject({ layout: '2R', columns: base.columns });
    expect(Object.keys(setLayout(three, '1').gadgets).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('저장값 복구 — 모르는 종류·중복·설정 없는 id를 버리고 열 수를 맞춘다, 깨진 값은 기본', () => {
    const raw = { v: 2, layout: '2', columns: [['a', 'x', 'a', 'ghost'], ['b'], ['c']], gadgets: { a: g('a'), b: g('b', 'pie'), c: g('c'), x: g('x', 'nope') } };
    const n = normalize(raw, ['filter', 'pie'], base);
    expect(n.columns).toEqual([['a'], ['b', 'c']]);
    expect(Object.keys(n.gadgets).sort()).toEqual(['a', 'b', 'c']);
    expect(normalize('garbage', ['filter'], base)).toEqual(base);
    expect(normalize({ v: 1, layout: '2', columns: [] }, ['filter'], base)).toEqual(base);
  });

  it('놓을 자리 — 가젯 가운데보다 위면 그 앞', () => {
    expect(dropIndex([100, 300, 500], 50)).toBe(0);
    expect(dropIndex([100, 300, 500], 301)).toBe(2);
    expect(dropIndex([100, 300, 500], 900)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe('v1 → v2 한 번 옮기기', () => {
  afterEach(() => localStorage.clear());

  it('v1 가젯 ID를 인스턴스 id로, 바뀐 종류는 옮기고(거버넌스 → 소개, 내 차례 → 나에게 할당됨, 이상 건 → 필터 결과), 접힘은 최소화', () => {
    const b = migrateV1({ v: 1, layout: '2L', columns: [['governance', 'myWork', 'zz'], ['anomalies', 'links']], collapsed: ['links'] })!;
    expect(b).toMatchObject({ v: 2, layout: '2L', columns: [['governance', 'myWork'], ['anomalies', 'links']] });
    expect(b.gadgets.governance.type).toBe('intro');
    expect(b.gadgets.myWork.type).toBe('assigned');
    expect(b.gadgets.anomalies).toMatchObject({ type: 'filter', config: { source: 'anomalies', status: 'open' }, configured: true });
    expect(b.gadgets.links.minimized).toBe(true);
    // 서버가 받는 모양이다
    expect(DashboardBoard.safeParse(b).success).toBe(true);
    expect(migrateV1({ v: 2 })).toBeNull();
    expect(migrateV1(null)).toBeNull();
  });

  it('역할별 저장소에서 읽고, 지우면 다시 옮기지 않는다', () => {
    localStorage.setItem(V1_KEY('operator'), JSON.stringify({ v: 1, layout: '3', columns: [['kills'], ['summary'], ['procedures']], collapsed: [] }));
    expect(readV1('author')).toBeNull();
    expect(readV1('operator')!.columns).toEqual([['kills'], ['summary'], ['procedures']]);
    clearV1('operator');
    expect(readV1('operator')).toBeNull();
    localStorage.setItem(V1_KEY('operator'), '{broken');
    expect(readV1('operator')).toBeNull();
  });
});

describe('시스템 대시보드(역할별 기본)', () => {
  const ROLES = ['author', 'approver', 'quality', 'operator', 'steward', 'commerce', 'integrator', 'coordinator', 'viewer'];

  it('역할마다 서버 스키마를 통과하고, 업무 절차 지도(procedures)를 그대로 두며, 브랜드 소개는 기본에 없다', () => {
    for (const role of ROLES) {
      const b = systemBoard(role);
      expect(DashboardBoard.safeParse(b).success, role).toBe(true);
      expect(b.gadgets.procedures?.type, role).toBe('procedures');
      expect(Object.values(b.gadgets).some((x) => x.type === 'intro'), role).toBe(false);
      expect(Object.values(b.gadgets).every((x) => x.configured && TYPE_IDS.includes(x.type as never)), role).toBe(true);
    }
    expect(systemBoard('nobody')).toEqual(systemBoard('viewer'));
  });

  it('데모 데이터 ID를 박지 않는다(빈 설치 RD-OPS-02) — 구성에는 원천·상태·기준만', () => {
    for (const role of ROLES) expect(JSON.stringify(systemBoard(role).gadgets)).not.toMatch(/FEAT-\d|POL-\d|ANM-\d|KILL-\d|ego-\d/);
  });

  it('필터 결과 제목은 데이터 이름을 붙이고, 구성한 제목이 있으면 그것', () => {
    expect(gadgetTitle('filter', { source: 'anomalies' })).toBe('필터 결과: 이상 건');
    expect(gadgetTitle('pie', { source: 'features', title: '  내 차트 ' })).toBe('내 차트');
    expect(gadgetTitle('summary', {})).toBe('운영 요약');
    expect(GADGET_TYPES.map((t) => t.category).sort()).toEqual(expect.arrayContaining(['charts', 'lists', 'ops', 'shortcuts']));
  });
});
