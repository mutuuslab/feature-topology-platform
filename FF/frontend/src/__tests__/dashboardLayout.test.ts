// 대시보드 배치 모델 — 끌어 옮기기·메뉴 이동·추가·제거·레이아웃 바꾸기·저장값 복구
import { add, dropIndex, move, moveBy, normalize, placed, remove, setLayout, toggleCollapsed, type Board } from '../screens/home/dashboard/layout';

const known = ['a', 'b', 'c', 'd', 'e'];
const base: Board = { v: 1, layout: '2', columns: [['a', 'b', 'c'], ['d']], collapsed: [] };

describe('대시보드 배치', () => {
  it('같은 열에서 아래로 끌면 놓은 표시 자리에 들어간다(빠진 자리 보정)', () => {
    expect(move(base, 'a', 0, 2).columns[0]).toEqual(['b', 'a', 'c']);
    expect(move(base, 'a', 0, 3).columns[0]).toEqual(['b', 'c', 'a']);
    expect(move(base, 'c', 0, 0).columns[0]).toEqual(['c', 'a', 'b']);
  });

  it('다른 열로 옮기고, 범위 밖 자리는 열 끝', () => {
    const b = move(base, 'b', 1, 0);
    expect(b.columns).toEqual([['a', 'c'], ['b', 'd']]);
    expect(move(base, 'b', 1, 99).columns[1]).toEqual(['d', 'b']);
    expect(move(base, 'b', 5, 0)).toBe(base);
  });

  it('메뉴 이동(키보드 대안) — 위·아래·왼쪽·오른쪽, 끝에서는 그대로', () => {
    expect(moveBy(base, 'b', 'up').columns[0]).toEqual(['b', 'a', 'c']);
    expect(moveBy(base, 'b', 'down').columns[0]).toEqual(['a', 'c', 'b']);
    expect(moveBy(base, 'a', 'up')).toBe(base);
    expect(moveBy(base, 'c', 'right').columns).toEqual([['a', 'b'], ['d', 'c']]);
    expect(moveBy(base, 'd', 'right')).toBe(base);
  });

  it('추가는 첫 열 맨 위, 이미 있으면 그대로 · 제거는 접힘 표시도 지운다', () => {
    expect(add(base, 'e').columns[0][0]).toBe('e');
    expect(add(base, 'a')).toBe(base);
    const c = toggleCollapsed(base, 'b');
    expect(c.collapsed).toEqual(['b']);
    expect(remove(c, 'b')).toMatchObject({ columns: [['a', 'c'], ['d']], collapsed: [] });
  });

  it('레이아웃을 줄여도 가젯을 잃지 않는다 — 넘친 열은 마지막 열 아래로', () => {
    const three: Board = { ...base, layout: '3', columns: [['a'], ['b'], ['c', 'd']] };
    expect(setLayout(three, '1').columns).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('레이아웃을 늘리면 새 열이 비지 않게 긴 열의 아래 가젯부터 나눈다(열 안 순서 유지)', () => {
    const one: Board = { ...base, layout: '1', columns: [['a', 'b', 'c', 'd', 'e']] };
    expect(setLayout(one, '3').columns).toEqual([['a', 'b'], ['c', 'e'], ['d']]);
    expect(setLayout(base, '3').columns).toEqual([['a', 'b'], ['d'], ['c']]);
    // 높이를 알면 높이로 — 큰 가젯 하나(a)는 혼자 두고 작은 것들을 새 열로
    const two: Board = { ...base, layout: '2', columns: [['a', 'b', 'c'], ['d', 'e']] };
    expect(setLayout(two, '3', { a: 600, b: 100, c: 100, d: 200, e: 200 }).columns).toEqual([['a'], ['d', 'e'], ['b', 'c']]);
    // 받는 열에 이미 가젯이 있으면 그 아래에 붙인다 — 맨 위 가젯 위로 끼어들지 않는다
    const tall: Board = { ...base, layout: '2', columns: [['a', 'b', 'c'], ['d']] };
    expect(setLayout(tall, '3', { a: 100, b: 300, c: 300, d: 50 }).columns).toEqual([['a'], ['d', 'b'], ['c']]);
    // 2열 ↔ 2L은 열 수가 같다 — 배치를 건드리지 않는다
    expect(setLayout(base, '2L').columns).toEqual(base.columns);
  });

  it('저장값 복구 — 모르는 가젯·중복 제거, 열 수 맞춤, 깨진 값은 기본 배치', () => {
    const n = normalize({ v: 1, layout: '2', columns: [['a', 'zz', 'a'], ['b'], ['c']], collapsed: ['b', 'zz'] }, known, base);
    expect(n.columns).toEqual([['a'], ['b', 'c']]);
    expect(n.collapsed).toEqual(['b']);
    expect(normalize('garbage', known, base)).toEqual(base);
    expect(normalize({ v: 2 }, known, base)).not.toBe(base);
    expect(placed(base)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('놓을 자리 — 가젯 가운데보다 위면 그 앞', () => {
    expect(dropIndex([100, 300, 500], 50)).toBe(0);
    expect(dropIndex([100, 300, 500], 301)).toBe(2);
    expect(dropIndex([100, 300, 500], 900)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});
