// 업무 절차 흐름도 배치 알고리즘 — 13개 절차 모두에서 상자 겹침 0·간선 끝점·직교 경로·상자 관통 0·간선 겹침 0·결정성.
// 배치는 외부 라이브러리 없이 screens/procedures/flow/layout.ts가 계산한다(열 = 위상 순위, 행 = 레인 × 칸 안 순서).
// 표기는 절차서 방식: 입력 레인(밖에서 오는 문서) · 역할 레인(활동) · 산출물 레인(만든 문서), 제어 흐름(옆) · 객체 흐름(위아래).
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { crossings, layoutFlow, layoutProblems } from '../screens/procedures/flow/layout';
import { buildProcessGraph, endId, gateId, IN_LANE, inDocId, isObjectFlow, OUT_LANE, outDocId, PROCESS_LAYOUT, startId, wpInfoOf } from '../screens/procedures/flow/model';
import { layoutMyFlow, MY_FLOW_FULL, myWorkSteps } from '../screens/procedures/flow/myFlow';
import { layoutValueChain } from '../screens/procedures/flow/valueChain';

const procs = WORKFLOWS.processes;
const graphOf = (p: (typeof procs)[number]) => buildProcessGraph(p, wpInfoOf(WORKFLOWS));
const layoutOf = (p: (typeof procs)[number]) => layoutFlow(graphOf(p), PROCESS_LAYOUT);

describe('흐름도 배치 — 13개 절차 전부', () => {
  it('절차는 13개다', () => expect(procs.length).toBe(13));

  for (const p of procs) {
    describe(p.id, () => {
      const g = graphOf(p);
      const l = layoutFlow(g, PROCESS_LAYOUT);

      it('상자 겹침·끝점 없는 간선·사선·상자 관통·같은 선 위 겹침이 없다', () => {
        expect(layoutProblems(l)).toEqual([]);
      });

      it('모든 활동이 상자로 있고, 간선은 양 끝 상자가 모두 있다', () => {
        const ids = new Set(l.nodes.map((n) => n.id));
        for (const a of p.activities) expect(ids.has(a.id)).toBe(true);
        for (const e of l.edges) {
          expect(ids.has(e.from)).toBe(true);
          expect(ids.has(e.to)).toBe(true);
        }
        // 숨은 간선(산출물 의존 순서)은 그리지 않는다
        expect(l.edges.length).toBe(g.edges.filter((e) => !e.hidden).length);
      });

      it('산출물 문서: 만드는 산출물마다 산출물 레인(맨 아래)에, 밖에서 오는 입력마다 입력 레인(맨 위)에 하나씩', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        const made = [...new Set(p.activities.flatMap((a) => a.outputs))];
        const ext = [...new Set(p.activities.flatMap((a) => a.inputs))].filter((k) => !made.includes(k));
        for (const k of made) expect(at.get(outDocId(p, k))?.lane).toBe(OUT_LANE);
        for (const k of ext) {
          expect(at.get(inDocId(p, k))?.lane).toBe(IN_LANE);
          expect(at.get(inDocId(p, k))?.external).toBe(true);
        }
        // 참조 문서 — 앞 활동 산출물을 다음 활동 연결 없이 쓰면 입력 레인에 그 산출물의 참조를 하나 둔다
        const refs = l.nodes.filter((n) => n.ref);
        for (const r of refs) {
          expect(r.lane).toBe(IN_LANE);
          expect(made).toContain(r.wp);
        }
        expect(l.nodes.filter((n) => n.kind === 'doc').length).toBe(made.length + ext.length + refs.length);
        expect(l.lanes[l.lanes.length - 1].id).toBe(OUT_LANE);
        if (ext.length) expect(l.lanes[0].id).toBe(IN_LANE);
        // 역할 레인에는 활동(과 시작·종료·Gate)만, 입력·산출물 레인에는 문서만
        for (const n of l.nodes) expect(n.kind === 'doc').toBe(n.lane === IN_LANE || n.lane === OUT_LANE);
      });

      it('제어 흐름은 상자 옆(오른쪽 변 → 왼쪽 변), 객체 흐름은 상자 위아래 변 — 둘은 모양이 다르고 섞이지 않는다', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        for (const e of l.edges) {
          const s = at.get(e.from)!;
          const t = at.get(e.to)!;
          const [x0, y0] = e.points[0];
          const [x1, y1] = e.points[e.points.length - 1];
          if (isObjectFlow(e.kind)) {
            expect(e.style).toBe('object');
            // 한쪽 끝은 문서
            expect([s.kind, t.kind].filter((k) => k === 'doc').length).toBe(1);
            const onTopOrBottom = (n: typeof s, y: number) => Math.abs(y - n.y) < 0.6 || Math.abs(y - (n.y + n.h)) < 0.6;
            expect(onTopOrBottom(s, y0)).toBe(true);
            expect(onTopOrBottom(t, y1)).toBe(true);
            expect(x0).toBeGreaterThan(s.x);
            expect(x0).toBeLessThan(s.x + s.w);
          } else {
            expect(e.style).toBe('control');
            expect(s.kind).not.toBe('doc');
            expect(t.kind).not.toBe('doc');
            // 첫 구간은 출발 상자에서 오른쪽으로, 마지막 구간은 도착 상자로 오른쪽으로 들어간다
            expect(e.points[1][0]).toBeGreaterThan(x0 - 0.5);
            expect(x1).toBeLessThanOrEqual(t.x + t.w / 2 + 0.5);
            expect(Math.abs(y0 - (s.y + s.h / 2))).toBeLessThanOrEqual(s.h / 2);
          }
        }
        expect(l.edges.some((e) => isObjectFlow(e.kind))).toBe(true);
      });

      it('시작은 첫 열, 종료는 마지막 열이고, Gate 판정은 마름모로 판정 활동 바로 뒤에 있다', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        const max = Math.max(...l.nodes.map((n) => n.rank));
        expect(at.get(startId(p))!.rank).toBe(0);
        expect(at.get(endId(p))!.rank).toBe(max);
        for (const a of p.activities.filter((x) => x.gateDecision)) {
          const gate = at.get(gateId(a))!;
          expect(gate.shape).toBe('diamond');
          expect(gate.rank).toBeGreaterThan(at.get(a.id)!.rank);
        }
      });

      it('산출물을 입력으로 쓰는 활동은 만든 활동보다 뒤 열이다(순환 간선 제외)', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        for (const e of g.edges.filter((x) => x.kind === 'data')) expect(at.get(e.to)!.rank).toBeGreaterThan(at.get(e.from)!.rank);
      });

      it('레인 = 수행(R) 첫 역할', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        for (const a of p.activities) expect(at.get(a.id)!.lane).toBe(a.raci.R[0]);
        expect(l.lanes.filter((x) => x.id !== IN_LANE && x.id !== OUT_LANE).map((x) => x.id).sort()).toEqual([...new Set(p.activities.map((a) => a.raci.R[0]))].sort());
        expect(new Set(l.lanes.map((x) => x.id)).size).toBe(l.lanes.length);
      });

      it('같은 입력이면 같은 좌표(결정적)', () => {
        const again = layoutOf(p);
        expect(JSON.stringify(again)).toBe(JSON.stringify(l));
      });

      it('상자는 자기 레인 띠 안에 있다', () => {
        const lane = new Map(l.lanes.map((x) => [x.id, x]));
        for (const n of l.nodes) {
          const ln = lane.get(n.lane)!;
          expect(n.y).toBeGreaterThanOrEqual(ln.y);
          expect(n.y + n.h).toBeLessThanOrEqual(ln.y + ln.h);
        }
      });
    });
  }

  it('간선 교차 수 합이 측정 상한을 넘지 않는다 — 품질 래칫', () => {
    const total = procs.reduce((s, p) => s + crossings(layoutOf(p)), 0);
    // 측정치 253(2026-10-25, 13개 절차 합 — 절차서 표기로 입력·산출물 문서와 객체 흐름이 더해졌다). 늘면 배치 알고리즘이 나빠진 것이다 — 줄이면 이 상한도 내린다
    expect(total).toBeLessThanOrEqual(260);
  });
});

describe('흐름도 배치 — 일반 그래프', () => {
  it('순환이 있어도 끝난다 — 되돌림 간선은 back으로 표시되고 겹침이 없다', () => {
    const l = layoutFlow({
      nodes: ['a', 'b', 'c'].map((id) => ({ id, lane: id === 'b' ? 'L2' : 'L1', w: 100, h: 60, shape: 'rect' as const })),
      edges: [
        { id: 'ab', from: 'a', to: 'b', label: '산출물' },
        { id: 'bc', from: 'b', to: 'c' },
        { id: 'ca', from: 'c', to: 'a', label: '되돌림' },
      ],
    });
    expect(l.edges.find((e) => e.id === 'ca')!.back).toBe(true);
    expect(layoutProblems(l)).toEqual([]);
  });

  it('한 칸(레인×열)에 여러 상자가 오면 행을 나눈다 — 겹치지 않는다', () => {
    const l = layoutFlow({
      nodes: [{ id: 's', lane: 'L', w: 40, h: 40, shape: 'circle' as const }, ...['x', 'y', 'z'].map((id) => ({ id, lane: 'L', w: 120, h: 60, shape: 'rect' as const }))],
      edges: ['x', 'y', 'z'].map((t) => ({ id: `s${t}`, from: 's', to: t, label: t })),
    });
    expect(new Set(l.nodes.filter((n) => n.id !== 's').map((n) => n.row)).size).toBe(3);
    expect(layoutProblems(l)).toEqual([]);
  });
});

describe('내 업무 흐름 배치 — 데모 역할 9개 전부', () => {
  for (const [persona, roleIds] of Object.entries(WORKFLOWS.personas)) {
    it(`${persona}: 줄마다 겹침 0, 내 활동이 한 세로줄에 서고, 사슬이 이웃 활동을 잇는다`, () => {
      const steps = myWorkSteps(WORKFLOWS, roleIds);
      const l = layoutMyFlow(steps, WORKFLOWS, MY_FLOW_FULL);
      expect(l.rows.length).toBe(steps.length);
      const xs = new Set<number>();
      let prevBottom = -Infinity;
      for (const r of l.rows) {
        expect(layoutProblems(r.layout)).toEqual([]);
        const c = r.layout.nodes.find((n) => n.side === 'center')!;
        xs.add(Math.round(c.x + c.w / 2));
        expect(r.y).toBeGreaterThan(prevBottom);
        prevBottom = r.y + r.height;
      }
      if (steps.length) expect([...xs]).toEqual([Math.round(l.centerX)]);
      expect(l.chain.length).toBe(Math.max(0, steps.length - 1));
      for (const c of l.chain) expect(c.points[1][1]).toBeGreaterThan(c.points[0][1]);
    });
  }

  it('받는 곳은 내 입력 산출물을 만든 활동의 역할, 넘기는 곳은 내 산출물을 쓰는 활동의 역할', () => {
    const steps = myWorkSteps(WORKFLOWS, WORKFLOWS.personas.author);
    const a01 = steps.find((s) => s.activity.id === 'FPW.1-A01')!;
    const act = new Map(WORKFLOWS.processes.flatMap((p) => p.activities).map((a) => [a.id, a]));
    for (const c of a01.to) for (const x of c.activities) {
      const b = act.get(x.id)!;
      expect(b.raci.R[0]).toBe(c.role);
      expect(b.inputs.some((k) => a01.activity.outputs.includes(k)) || a01.activity.next.includes(b.id)).toBe(true);
    }
    expect(a01.to.length).toBeGreaterThan(0);
  });
});

describe('전체 지도 배치', () => {
  for (const w of [900, 1100, 1366, 1600]) {
    it(`폭 ${w}: 13칸 겹침 0, 폭 안에 들어가고, 생애주기 화살표가 차례로 잇는다`, () => {
      const l = layoutValueChain(WORKFLOWS.processes, w);
      expect(l.boxes.length).toBe(13);
      for (let i = 0; i < l.boxes.length; i++)
        for (let j = i + 1; j < l.boxes.length; j++) {
          const a = l.boxes[i];
          const b = l.boxes[j];
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
        }
      for (const b of l.boxes) expect(b.x + b.w).toBeLessThanOrEqual(l.width);
      if (w >= 900) expect(l.width).toBeLessThanOrEqual(w);
      const life = WORKFLOWS.processes.filter((p) => p.group === WORKFLOWS.processes[0].group);
      expect(l.arrows.map((a) => a.from)).toEqual(life.slice(0, -1).map((p) => p.id));
    });
  }
});
