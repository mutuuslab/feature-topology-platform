// Topology 관계 그래프 작업대 — 실제 v0.81 Feature·관계로 선택·키보드 이동·간선 근거·필터·도메인 접기·경로·영향·흐름 모션·표 보기·찾기.
// 이전 '선택 관계 설명'(동심원 그래프 위 점 모션)의 약속 — 실제 쌍과 근거, 움직임 줄이기·숨은 화면에서 멈춤 — 을 새 그래프에서 다시 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { TopologyWorkbench } from '../screens/master/topology/TopologyWorkbench';
import { topologyGraph as G } from '../copy/topology-graph';
import { topologyMotion as M } from '../copy/topology-motion';
import deps from '../../../data/fixtures/v0.81/dependencies.json';
import features from '../../../data/fixtures/v0.81/features.json';
import type { DepRow, FeatureRow, PrecheckRule } from '../screens/master/topology/model';

const FEATS = features as unknown as FeatureRow[];
const DEPS = deps as unknown as DepRow[];
const RULES: PrecheckRule[] = [{ ruleId: 'DATA-PRECHECK-1.0-04', title: 'REQUIRES Lifecycle', result: 'FAIL', findings: [{ key: 'DEP-00010', result: 'FAIL', message: '원천 PROPOSED — 승인 전 관계 판정 대기' }] }];
const relation = DEPS.find((d) => d.dependencyId === 'DEP-00010')!;
let media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };

function Harness({ onSelect = vi.fn(), initial = { feature: 'FEAT-00013', relation: 'DEP-00010' as string | null } }: { onSelect?: (n: object) => void; initial?: { feature: string; relation: string | null } }) {
  const [sel, setSel] = useState<{ feature: string | null; relation: string | null }>(initial);
  return (
    <MemoryRouter>
      <TopologyWorkbench
        features={FEATS}
        deps={DEPS}
        rules={RULES}
        focus={sel.feature}
        relation={sel.relation}
        onSelect={(n) => {
          onSelect(n);
          setSel((s) => ({ feature: n.feature === undefined ? s.feature : n.feature, relation: n.relation === undefined ? s.relation : n.relation }));
        }}
      />
    </MemoryRouter>
  );
}
const stage = () => document.querySelector('.topo-stage') as HTMLElement;
const node = (id: string) => document.querySelector(`[data-node="${id}"]`) as SVGGElement;
const status = () => document.querySelector('.topo-wb__status')!.textContent!;
const lanes = () => [...document.querySelectorAll('.topo-lanehead > [data-domain]')].map((g) => g.getAttribute('data-domain'));

beforeEach(() => {
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Topology 관계 그래프', () => {
  it('실제 예측 공조 → 배터리 급속충전 예열 관계를 선택해 근거·사전점검·다음 조치를 보이고, 노드는 도메인 레인에 카드로', () => {
    render(<Harness />);
    const panel = screen.getByRole('region', { name: M.title });
    expect(panel.getAttribute('data-verdict')).toBe('미판정');
    expect(within(panel).getByText(relation.rationale!)).toBeTruthy();
    expect(within(panel).getByText('REQUIRES Lifecycle')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'FEAT-00174@0.2.0' }).getAttribute('href')).toBe('/features/FEAT-00174/0.2.0');
    expect(within(panel).getByText(M.notice)).toBeTruthy();
    const sel = document.querySelector('.ds-topo-edge[data-selected]')!;
    expect(sel.getAttribute('data-verdict')).toBe('미판정');
    expect(sel.getAttribute('marker-end')).toBe('url(#topo-ar-PENDING)');
    expect(node('FEAT-00013').getAttribute('aria-pressed')).toBe('true');
    expect(node('FEAT-00013').getAttribute('aria-label')).toContain('예측 공조');
    // 카드 — 도메인 띠·포트, 레인 머리
    expect(node('FEAT-00013').getAttribute('data-domain')).toBe('BC');
    expect(node('FEAT-00174').getAttribute('data-domain')).toBe('PE');
    expect(node('FEAT-00013').querySelector('.topo-port')).not.toBeNull();
    expect(lanes()).toEqual(['AD', 'SF', 'CH', 'PE', 'BC', 'IN']);
    // 이웃 1·2단계 강조, 나머지 흐림
    expect(node('FEAT-00174').getAttribute('data-state')).toBe('hl1');
    expect(node('FEAT-00001').hasAttribute('data-dim')).toBe(true);
  });

  it('EXCLUDES는 화살표 없이 양끝 막대, 다른 관계를 누르면 그 관계의 근거로 바뀐다', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const ex = document.querySelector('[data-edge="DEP-00014"]')!;
    expect(ex.querySelector('.ds-topo-edge')!.getAttribute('marker-start')).toBe('url(#topo-tee-PASS)');
    expect(ex.querySelector('.ds-topo-edge')!.getAttribute('marker-end')).toBe('url(#topo-tee-PASS)');
    fireEvent.click(ex);
    expect(onSelect).toHaveBeenLastCalledWith({ relation: 'DEP-00014', feature: 'FEAT-00023' });
    const panel = screen.getByRole('region', { name: M.title });
    expect(panel.getAttribute('data-type')).toBe('EXCLUDES');
    expect(within(panel).getByText(M.excludes)).toBeTruthy();
  });

  it('키보드 — 그래프 안 한 칸만 Tab 정지, 화살표로 가까운 Feature, Enter로 선택', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const tabbable = [...document.querySelectorAll('.ds-topo-node')].filter((n) => n.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(node('FEAT-00013'));
    act(() => node('FEAT-00013').focus());
    fireEvent.keyDown(node('FEAT-00013'), { key: 'ArrowRight' });
    const moved = document.activeElement as SVGGElement;
    expect(moved.getAttribute('data-node')).toBeTruthy();
    expect(moved.getAttribute('data-node')).not.toBe('FEAT-00013');
    expect(moved.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(moved, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith({ feature: moved.getAttribute('data-node'), relation: null });
  });

  it('필터 — 도메인 칩으로 레인을 좁히고, 지우기로 돌아오며, 관계 없는 Feature도 넣을 수 있다', () => {
    render(<Harness />);
    const before = status();
    fireEvent.click(within(screen.getByRole('group', { name: G.domain })).getByRole('button', { name: /^AD/ }));
    expect(lanes()).toEqual(['AD']);
    expect(status()).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: G.reset }));
    expect(status()).toBe(before);
    fireEvent.click(screen.getByRole('checkbox', { name: G.isolated }));
    expect(status()).toMatch(/^Feature 68 /);
  });

  it('도메인 접기 — 레인이 묶음 카드 하나가 되고, 묶음을 누르면 다시 펼친다', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: G.collapse('ADAS & AD') }));
    const agg = node('agg:AD');
    expect(agg.getAttribute('aria-label')).toMatch(/Feature \d+ · 안쪽 관계 \d+/);
    expect(node('FEAT-00001')).toBeNull();
    fireEvent.click(agg);
    expect(node('agg:AD')).toBeNull();
    expect(node('FEAT-00001')).not.toBeNull();
  });

  it('경로 찾기 — 의존 방향 경로를 번호로 강조하고, 없으면 그렇다고 말한다', () => {
    render(<Harness initial={{ feature: 'FEAT-00001', relation: null }} />);
    fireEvent.click(screen.getByRole('button', { name: G.path }));
    expect(status()).toContain(G.pathPick);
    fireEvent.change(screen.getByRole('combobox', { name: G.pathTo }), { target: { value: 'FEAT-00002' } });
    expect(status()).toContain(G.pathResult(1, 'requires'));
    expect(node('FEAT-00002').querySelector('.topo-card__badge text')!.textContent).toBe('2');
    fireEvent.change(screen.getByRole('combobox', { name: G.pathTo }), { target: { value: 'FEAT-00013' } });
    expect(status()).toContain(G.pathNone('FEAT-00001', 'FEAT-00013'));
  });

  it('영향 분석 — 선택 Feature에 의존하는 Feature를 단계와 함께 강조한다', () => {
    render(<Harness initial={{ feature: 'FEAT-00002', relation: null }} />);
    fireEvent.click(screen.getByRole('button', { name: G.impact }));
    expect(status()).toMatch(/FEAT-00002를 바꾸면 \d+개 Feature가 영향을 받습니다/);
    expect(node('FEAT-00001').getAttribute('data-state')).toBe('hl1');
    expect(node('FEAT-00001').querySelector('.topo-card__badge text')!.textContent).toBe('1');
  });

  it('흐름 모션 — 켜고 끄며, 숨은 화면에서는 멈춘다', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get');
    render(<Harness />);
    const flow = screen.getByRole('button', { name: G.flow });
    expect(flow.getAttribute('aria-pressed')).toBe('true');
    expect(stage().getAttribute('data-flow')).toBe('on');
    expect(document.querySelectorAll('.topo-flow').length).toBeGreaterThan(0);
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    expect(stage().getAttribute('data-flow')).toBe('off');
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
    expect(stage().getAttribute('data-flow')).toBe('on');
    fireEvent.click(flow);
    expect(stage().getAttribute('data-flow')).toBe('off');
  });

  it('움직임 줄이기 설정이면 흐름 버튼을 막고 정적으로 그린다', () => {
    media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    render(<Harness />);
    expect((screen.getByRole('button', { name: G.flow }) as HTMLButtonElement).disabled).toBe(true);
    expect(stage().getAttribute('data-flow')).toBe('off');
  });

  it('표 보기 — 같은 Feature를 표로, ID를 누르면 선택한다', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: G.views.table }));
    expect(document.querySelector('.topo-stage')).toBeNull();
    const table = screen.getByRole('table', { name: G.table.features });
    const row = within(table).getByRole('button', { name: 'FEAT-00013' }).closest('tr')!;
    expect(row.textContent).toContain('FEAT-00174 (미판정)');
    fireEvent.click(within(table).getByRole('button', { name: 'FEAT-00001' }));
    expect(onSelect).toHaveBeenLastCalledWith({ feature: 'FEAT-00001', relation: null });
  });

  it('찾기 — ID 끝자리나 이름으로 Feature를 고르고, 없으면 안내한다', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: G.search });
    fireEvent.change(input, { target: { value: '00022' } });
    fireEvent.submit(input.closest('form')!);
    expect(onSelect).toHaveBeenLastCalledWith({ feature: 'FEAT-00022', relation: null });
    fireEvent.change(input, { target: { value: '없는 기능 이름' } });
    fireEvent.submit(input.closest('form')!);
    expect(status()).toContain(G.notFound('없는 기능 이름'));
  });

  it('간선에 마우스를 올리면 근거(사전점검·판정 사유) 풍선을 보인다', () => {
    render(<Harness />);
    fireEvent.pointerEnter(document.querySelector('[data-edge="DEP-00010"]')!, { clientX: 100, clientY: 100 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('REQUIRES Lifecycle');
    expect(tip.textContent).toContain('예측 공조');
  });
});
