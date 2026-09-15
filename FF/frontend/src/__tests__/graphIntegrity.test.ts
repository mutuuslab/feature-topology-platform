/**
 * 관계 그래프 무결성 회귀 테스트 — /topology/:id (cytoscape)
 *
 * UI05 관계 사전은 구현 참조를 `ID@version` 로 적는다. 그래프는 버전 노드를 만들지 않으므로
 * 참조를 정규화하지 않으면 없는 노드를 가리키는 간선이 생기고, cytoscape 가 던진 예외가
 * 화면 하나가 아니라 제품 전체를 비운다(ErrorBoundary 이전 증상).
 * 여기서는 10개 Feature 전부에 대해 ① 간선 양 끝점이 실제 노드로 존재하고 ② 노드 id 가 유일하며
 * ③ 버전 표기가 라벨로 새어 나오지 않는지 ④ 버전 참조가 영향분석·비용에서 누락되지 않는지를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { features, relations } from '../data/model';
import { topology, impact, featureCost, artifact, refId } from '../data/engine';

const graphOf = (id: string) => topology(id);

describe('Topology 그래프 무결성', () => {
  it('모든 Feature 그래프가 자기 완결적이다 — 없는 노드를 가리키는 간선이 없다', () => {
    for (const f of features) {
      const g = graphOf(f.id);
      const ids = new Set(g.nodes.map(n => n.data.id));
      expect(ids.size, `${f.id} 노드 id 중복`).toBe(g.nodes.length);
      for (const e of g.edges) {
        expect(ids.has(e.data.source), `${e.data.id} source ${e.data.source} 미존재`).toBe(true);
        expect(ids.has(e.data.target), `${e.data.id} target ${e.data.target} 미존재`).toBe(true);
      }
    }
  });

  it('버전 참조는 객체 노드로 접혀 표시된다 — 라벨에 @version 이 남지 않는다', () => {
    for (const f of features) {
      for (const n of graphOf(f.id).nodes) {
        expect(n.data.label, `${f.id} · ${n.data.id}`).not.toContain('@');
        expect(n.data.id).not.toContain('@');
      }
    }
  });

  it('관계 사전의 모든 버전 참조가 실제 객체로 해석된다', () => {
    for (const r of relations) {
      for (const ref of [r.source, r.target]) {
        const bare = refId(ref);
        const resolvable = features.some(f => f.id === bare) || !!artifact(bare);
        expect(resolvable, `${r.id}: ${ref} 해석 실패`).toBe(true);
      }
    }
  });

  it('영향분석이 버전 참조를 누락하지 않는다 — BDC 기준 SWC·ECU·API·TestCase 가 모두 잡힌다', () => {
    const i = impact('FEAT-BDC-001');
    expect(i.swcs).toContain('SWC-BDC-ADAPTER');
    expect(i.ecus).toContain('ECU-BDC');
    expect(i.apis).toContain('API-BDC-POLICY-CONTROL');
    expect(i.tests).toEqual(expect.arrayContaining(['HIL-BDC-001', 'OTA-RB-002', 'TEL-BDC-001']));
  });

  it('버전 참조를 대상으로도 영향분석이 시작된다', () => {
    expect(impact('SWC-BDC-ADAPTER@3.2.1').features).toContain('FEAT-BDC-001');
  });

  it('비용 추정이 연결 아티팩트를 버전과 무관하게 집계한다', () => {
    for (const f of features) {
      const c = featureCost(f.id);
      expect(Number.isFinite(c.estMM)).toBe(true);
      expect(c.estMM).toBeGreaterThan(0);
    }
  });
});
