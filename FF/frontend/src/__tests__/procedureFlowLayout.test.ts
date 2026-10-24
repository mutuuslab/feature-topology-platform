// 업무 절차 흐름도 배치 알고리즘 — 13개 절차 모두에서 상자 겹침 0·간선 끝점·직교 경로·간선 겹침 0·결정성.
// 배치는 외부 라이브러리 없이 screens/procedures/flow/layout.ts가 계산한다(열 = 위상 순위, 행 = 레인 × 칸 안 순서).
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { crossings, layoutFlow, layoutProblems } from '../screens/procedures/flow/layout';
import { buildProcessGraph, endId, gateId, startId } from '../screens/procedures/flow/model';
import { layoutMyFlow, MY_FLOW_FULL, myWorkSteps } from '../screens/procedures/flow/myFlow';
import { layoutValueChain } from '../screens/procedures/flow/valueChain';

const procs = WORKFLOWS.processes;

describe('흐름도 배치 — 13개 절차 전부', () => {
  it('절차는 13개다', () => expect(procs.length).toBe(13));

  for (const p of procs) {
    describe(p.id, () => {
      const g = buildProcessGraph(p);
      const l = layoutFlow(g);

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
        expect(l.edges.length).toBe(g.edges.length);
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
        for (const e of l.edges.filter((x) => !x.back && x.kind === 'data')) expect(at.get(e.to)!.rank).toBeGreaterThan(at.get(e.from)!.rank);
      });

      it('레인 = 수행(R) 첫 역할', () => {
        const at = new Map(l.nodes.map((n) => [n.id, n]));
        for (const a of p.activities) expect(at.get(a.id)!.lane).toBe(a.raci.R[0]);
        expect(new Set(l.lanes.map((x) => x.id)).size).toBe(l.lanes.length);
      });

      it('같은 입력이면 같은 좌표(결정적)', () => {
        const again = layoutFlow(buildProcessGraph(p));
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
    const total = procs.reduce((s, p) => s + crossings(layoutFlow(buildProcessGraph(p))), 0);
    // 측정치 49(2026-10-24, 13개 절차 합). 늘면 배치 알고리즘이 나빠진 것이다 — 줄이면 이 상한도 내린다
    expect(total).toBeLessThanOrEqual(52);
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
