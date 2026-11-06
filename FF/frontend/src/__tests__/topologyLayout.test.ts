// Topology 그래프 모델·배치 — 결정성, 레인·직교 간선·포트, 교차 수 래칫(harness/topology-layout.json), 순환·경로·영향·묶음·필터.
// 래칫: v0.81 데이터셋(Feature 80 Version · 관계 29)으로 이전 동심원 그래프(선택 Feature 주변 2단계)와 같은 부분 그래프의 교차를 비교한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import deps from '../../../data/fixtures/v0.81/dependencies.json';
import features from '../../../data/fixtures/v0.81/features.json';
import { countCrossings, layoutGraph, type Pt } from '../screens/master/topology/layout';
import { applyFilters, buildModel, collapseDomains, domainOf, findPath, impactOf, neighborhood, NO_FILTERS, type DepRow, type FeatureRow, type TEdge, type TModel } from '../screens/master/topology/model';

const FEATS = features as unknown as FeatureRow[];
const DEPS = deps as unknown as DepRow[];
const ratchetFile = resolve(__dirname, '../../../harness/topology-layout.json');
const ratchet = JSON.parse(readFileSync(ratchetFile, 'utf8')) as { egoCrossings: number; fullCrossings: number; legacyEgoCrossings: number; legacyFullCrossings: number };
const model = buildModel(FEATS, DEPS);
const linked = applyFilters(model, NO_FILTERS);
const lay = (m: TModel) => layoutGraph([...m.nodes.values()], m.edges);

/** 이전 화면의 동심원 배치(2026-11-05 Topology.tsx) — 선택 Feature를 가운데, 관계 거리마다 바깥 원, 선은 직선. focus가 없으면 전체를 한 원에 */
function legacyRing(m: TModel, focus: string | null): Pt[][] {
  const W = 760, H = 420;
  const dist = focus ? neighborhood(m.edges, focus, 99) : new Map<string, number>();
  const rings = new Map<number, string[]>();
  for (const id of [...m.nodes.keys()].sort()) {
    const d = dist.get(id) ?? (focus ? 3 : 1);
    rings.set(d, [...(rings.get(d) ?? []), id]);
  }
  const maxD = Math.max(1, ...rings.keys());
  const pos = new Map<string, Pt>();
  for (const [d, ids] of rings) {
    const r = d === 0 ? 0 : ((H / 2 - 60) * d) / maxD;
    ids.forEach((id, i) => {
      const a = (2 * Math.PI * i) / ids.length - Math.PI / 2 + d * 0.4;
      pos.set(id, [W / 2 + r * 1.6 * Math.cos(a), H / 2 + r * Math.sin(a)]);
    });
  }
  return m.edges.map((e) => [pos.get(e.source)!, pos.get(e.target)!]);
}
/** 선택 Feature 주변 2단계 부분 그래프 — 이전 화면의 깊이 기본값 */
function ego(m: TModel, focus: string): TModel {
  const keep = neighborhood(m.edges, focus, 2);
  return { nodes: new Map([...m.nodes].filter(([id]) => keep.has(id))), edges: m.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

describe('Topology 배치', () => {
  it('결정적 — 입력 순서를 섞어도 좌표·경로가 같다', () => {
    const a = lay(linked);
    const shuffled: TModel = { nodes: new Map([...linked.nodes].reverse()), edges: [...linked.edges].reverse() };
    const b = lay(shuffled);
    expect([...b.nodes.values()].map((n) => [n.id, n.x, n.y]).sort()).toEqual([...a.nodes.values()].map((n) => [n.id, n.x, n.y]).sort());
    expect([...b.edges.values()].map((e) => [e.id, e.d]).sort()).toEqual([...a.edges.values()].map((e) => [e.id, e.d]).sort());
    expect(b.crossings).toBe(a.crossings);
  });

  it('도메인 레인 — 노드는 자기 도메인 레인 안에, 레인은 정해진 순서로 겹치지 않는다', () => {
    const l = lay(linked);
    expect(l.lanes.map((x) => x.domain)).toEqual(['AD', 'SF', 'CH', 'PE', 'BC', 'IN']);
    for (let i = 1; i < l.lanes.length; i++) expect(l.lanes[i].y).toBeGreaterThanOrEqual(l.lanes[i - 1].y + l.lanes[i - 1].h);
    for (const n of l.nodes.values()) {
      const lane = l.lanes.find((x) => x.domain === n.lane)!;
      expect(n.lane).toBe(linked.nodes.get(n.id)!.domain);
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.y + n.h).toBeLessThanOrEqual(lane.y + lane.h);
    }
    // 노드끼리 겹치지 않는다
    const boxes = [...l.nodes.values()];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id}↔${b.id}`).toBe(true);
      }
  });

  it('직교 간선 — 모든 구간이 가로·세로이고, REQUIRES는 원천 오른쪽 포트에서 나와 대상 왼쪽 포트로 들어간다', () => {
    const l = lay(linked);
    for (const e of linked.edges) {
      const p = l.edges.get(e.id)!.points;
      for (let i = 1; i < p.length; i++) expect(p[i][0] === p[i - 1][0] || p[i][1] === p[i - 1][1], e.id).toBe(true);
      const s = l.nodes.get(e.source)!, t = l.nodes.get(e.target)!;
      const last = p[p.length - 1];
      // 경로는 언제나 원천 포트에서 시작한다
      expect(p[0][1], e.id).toBe(s.y + s.h / 2);
      if (e.type === 'REQUIRES') {
        expect(p[0][0], e.id).toBe(s.x + s.w);
        expect(last, e.id).toEqual([t.x, t.y + t.h / 2]);
      } else {
        // EXCLUDES는 방향이 없어 마주 보는 쪽끼리 — 왼쪽 열 카드의 오른쪽 포트 ↔ 오른쪽 열 카드의 왼쪽 포트, 같은 열이면 둘 다 오른쪽
        const [sx, tx] = s.col === t.col ? [s.x + s.w, t.x + t.w] : s.col < t.col ? [s.x + s.w, t.x] : [s.x, t.x + t.w];
        expect([p[0][0], last[0]], e.id).toEqual([sx, tx]);
        expect(last[1], e.id).toBe(t.y + t.h / 2);
      }
      // 간선은 노드 카드를 가로지르지 않는다(끝점 포트 제외)
      for (let i = 1; i < p.length; i++)
        for (const n of l.nodes.values()) {
          const [a, b] = [p[i - 1], p[i]];
          const inside = (x: number, y: number) => x > n.x + 0.5 && x < n.x + n.w - 0.5 && y > n.y + 0.5 && y < n.y + n.h - 0.5;
          expect(inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), `${e.id} through ${n.id}`).toBe(false);
        }
    }
  });

  it('교차 수 래칫 — 이전 동심원 그래프보다 늘지 않고(전체는 적고), 기록(harness/topology-layout.json)보다 늘지 않는다', () => {
    const foci = [...new Set(DEPS.flatMap((d) => [d.sourceFeatureId, d.targetFeatureId]))].sort();
    let legacy = 0, next = 0;
    for (const f of foci) {
      const sub = ego(linked, f);
      legacy += countCrossings(legacyRing(sub, f));
      next += lay(sub).crossings;
    }
    const full = lay(linked).crossings;
    // 이전 화면 값은 고정 — 측정 방식이 바뀌면 여기서 먼저 드러난다
    expect(legacy).toBe(ratchet.legacyEgoCrossings);
    expect(countCrossings(legacyRing(linked, null))).toBe(ratchet.legacyFullCrossings);
    expect(next).toBeLessThanOrEqual(legacy);
    expect(full).toBeLessThan(ratchet.legacyFullCrossings);
    expect(next, `선택 Feature 주변 교차 합 ${next} — 기록 ${ratchet.egoCrossings}`).toBeLessThanOrEqual(ratchet.egoCrossings);
    expect(full, `전체 그래프 교차 ${full} — 기록 ${ratchet.fullCrossings}`).toBeLessThanOrEqual(ratchet.fullCrossings);
    // 줄었으면 기록도 낮춘다(래칫은 좋아지는 방향으로만)
    if (next < ratchet.egoCrossings || full < ratchet.fullCrossings) console.warn(`topology-layout 래칫을 낮출 수 있습니다: ego ${next}, full ${full}`);
  });
});

describe('Topology 모델', () => {
  it('도메인 — 대표 기준 행 약어가 먼저, 없으면 태그 대응표, 둘 다 없으면 기타', () => {
    expect(domainOf({ domain: 'BC', tags: ['adas'] })).toBe('BC');
    expect(domainOf({ domain: null, tags: ['parking'] })).toBe('AD');
    expect(domainOf({ domain: 'XX', tags: ['ivi'] })).toBe('IN');
    expect(domainOf({ tags: ['전시'] })).toBe('ETC');
  });

  it('노드 = Feature ID 하나(Version 목록), 간선 판정 톤·Version 불일치', () => {
    const n = model.nodes.get('FEAT-00001')!;
    expect(n.versions).toEqual(['2.1.0', '2.2.0']);
    expect(n.version).toBe('2.2.0');
    const e = model.edges.find((x) => x.id === 'DEP-00001')!; // 대상 FEAT-00002 1.5.0 — 최신은 1.6.0
    expect(e.mismatch).toBe('stale');
    expect(model.edges.find((x) => x.id === 'DEP-00010')!.tone).toBe('PENDING');
  });

  const edge = (id: string, source: string, target: string, type: TEdge['type'] = 'REQUIRES', verdict = 'PASS'): DepRow => ({ dependencyId: id, type, sourceFeatureId: source, sourceVersion: '1.0.0', targetFeatureId: target, targetVersion: '1.0.0', verdict, rationale: null });
  const feat = (id: string, domain: string, extra: Partial<FeatureRow> = {}): FeatureRow => ({ featureId: id, version: '1.0.0', name: id, lifecycle: 'RELEASED', domain, ...extra });

  it('순환 — REQUIRES 강결합 요소의 간선만 표시하고, 배치는 순환이 있어도 끝난다', () => {
    const m = buildModel([feat('A', 'AD'), feat('B', 'AD'), feat('C', 'AD'), feat('D', 'AD')], [edge('1', 'A', 'B'), edge('2', 'B', 'C'), edge('3', 'C', 'A'), edge('4', 'C', 'D'), edge('5', 'D', 'A', 'EXCLUDES')]);
    expect(m.edges.filter((e) => e.cycle).map((e) => e.id)).toEqual(['1', '2', '3']);
    const l = lay(m);
    expect(l.edges.size).toBe(5);
    const p = l.edges.get('3')!.points; // 순환을 끊으려 뒤집어 놓아도 화살표 끝은 대상(A) 왼쪽 포트
    expect(p[p.length - 1]).toEqual([l.nodes.get('A')!.x, l.nodes.get('A')!.y + 38]);
  });

  it('경로 — 의존 방향 최단 경로, 없으면 반대 방향, 그다음 방향 무관', () => {
    const m = buildModel(['A', 'B', 'C', 'D', 'E'].map((x) => feat(x, 'AD')), [edge('1', 'A', 'B'), edge('2', 'B', 'C'), edge('3', 'A', 'C'), edge('4', 'D', 'C'), edge('5', 'E', 'A', 'EXCLUDES')]);
    expect(findPath(m.edges, 'A', 'C')).toEqual({ nodes: ['A', 'C'], edges: ['3'], mode: 'requires' });
    expect(findPath(m.edges, 'C', 'A')).toMatchObject({ nodes: ['C', 'A'], mode: 'reverse' });
    expect(findPath(m.edges, 'D', 'A')).toMatchObject({ nodes: ['D', 'C', 'A'], mode: 'any' });
    expect(findPath(m.edges, 'E', 'B')).toMatchObject({ mode: 'any', edges: ['5', '1'] });
    expect(findPath(m.edges, 'A', 'A')).toBeNull();
  });

  it('영향 분석 — 선택 Feature를 (간접으로) 필요로 하는 Feature와 단계, 함께 구성 불가 Feature', () => {
    const m = buildModel(['A', 'B', 'C', 'D', 'X'].map((x) => feat(x, 'AD')), [edge('1', 'B', 'A'), edge('2', 'C', 'B'), edge('3', 'A', 'D'), edge('4', 'X', 'A', 'EXCLUDES')]);
    expect([...impactOf(m.edges, 'A')]).toEqual([['B', { depth: 1, via: 'requires' }], ['C', { depth: 2, via: 'requires' }], ['X', { depth: 1, via: 'excludes' }]]);
  });

  it('도메인 접기 — 묶음 노드 하나, 안쪽 관계 수, 밖으로 나가는 관계는 (원천·대상·유형)마다 하나로 합치고 나쁜 판정을 남긴다', () => {
    const m = buildModel([feat('A', 'AD'), feat('B', 'AD'), feat('C', 'BC')], [edge('1', 'A', 'B'), edge('2', 'A', 'C'), edge('3', 'B', 'C', 'REQUIRES', 'FAIL')]);
    const c = collapseDomains(m, new Set(['AD']));
    expect([...c.nodes.keys()].sort()).toEqual(['C', 'agg:AD']);
    expect(c.nodes.get('agg:AD')!.agg).toEqual({ count: 2, inner: 1, members: ['A', 'B'] });
    expect(c.edges).toHaveLength(1);
    expect(c.edges[0]).toMatchObject({ source: 'agg:AD', target: 'C', count: 2, members: ['2', '3'], tone: 'FAIL' });
  });

  it('필터 — 도메인·ASIL·Lifecycle·Flag·판정, 관계 없는 Feature는 선택할 때만', () => {
    const m = buildModel(
      [feat('A', 'AD', { asil: 'B', controlPoints: ['Flag'] }), feat('B', 'BC', { asil: 'QM' }), feat('C', 'BC', { asil: 'QM', lifecycle: 'PROPOSED' }), feat('Z', 'IN')],
      [edge('1', 'A', 'B'), edge('2', 'B', 'C', 'REQUIRES', 'FAIL')],
    );
    const ids = (f: Partial<typeof NO_FILTERS>) => [...applyFilters(m, { ...NO_FILTERS, ...f }).nodes.keys()].sort();
    expect(ids({})).toEqual(['A', 'B', 'C']);
    expect(ids({ isolated: true })).toEqual(['A', 'B', 'C', 'Z']);
    expect(ids({ domains: new Set(['BC']) })).toEqual(['B', 'C']);
    expect(ids({ asil: new Set(['B']) })).toEqual([]); // A만 남으면 관계가 없다
    expect(ids({ verdict: 'FAIL' })).toEqual(['B', 'C']);
    expect(ids({ flagsOnly: true, isolated: true })).toEqual(['A']);
    expect(ids({ lifecycle: 'PROPOSED', isolated: true })).toEqual(['C']);
  });
});
