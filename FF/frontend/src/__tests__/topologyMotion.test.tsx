import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { TopologyGraph } from '../screens/master/Topology';
import { topologyMotion as M } from '../copy/topology-motion';
import deps from '../../../data/fixtures/v0.81/dependencies.json';
import features from '../../../data/fixtures/v0.81/features.json';

type GraphData = Parameters<typeof TopologyGraph>[0]['data'];
type Relation = Parameters<typeof TopologyGraph>[0]['relations'][number];
const relation = deps.find((d) => d.dependencyId === 'DEP-00010')! as Relation;
const source = features.find((f) => f.featureId === relation.sourceFeatureId && f.version === relation.sourceVersion)!;
const target = features.find((f) => f.featureId === relation.targetFeatureId && f.version === relation.targetVersion)!;
const graph: GraphData = {
  nodes: [source, target].map((f) => ({ id: `${f.featureId}@${f.version}`, featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle })),
  edges: [{ id: relation.dependencyId, source: `${source.featureId}@${source.version}`, target: `${target.featureId}@${target.version}`, type: 'REQUIRES' as const, verdict: relation.verdict }],
};
const mount = (data = graph, relations: Relation[] = [relation], onSelect = vi.fn()) => render(<MemoryRouter><TopologyGraph data={data} focus={source.featureId} selected={data.edges[0]?.id ?? null} relations={relations} onSelect={onSelect} /></MemoryRouter>);
const panel = () => screen.getByRole('region', { name: M.title });

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Topology relationship explanation', () => {
  it('uses the actual predictive HVAC → battery preheating pair, versions and pending rationale', () => {
    mount();
    expect(source.name).toBe('예측 공조'); expect(target.name).toBe('배터리 급속충전 예열');
    const p = panel();
    expect(p.getAttribute('data-verdict')).toBe('미판정');
    expect(within(p).getByText(relation.rationale)).toBeTruthy();
    expect(within(p).getByRole('link', { name: 'FEAT-00174@0.2.0' }).getAttribute('href')).toBe('/features/FEAT-00174/0.2.0');
    const diagram = within(p).getByRole('img');
    expect(diagram.getAttribute('data-source')).toBe('FEAT-00013@0.3.0');
    expect(diagram.getAttribute('data-target')).toBe('FEAT-00174@0.2.0');
    expect(diagram.querySelector('.topo-motion__track')?.hasAttribute('marker-end')).toBe(true);
    expect(within(p).getByText(M.notice)).toBeTruthy();
    expect(p.getAttribute('data-running')).toBe('false');
  });

  it('plays, pauses, changes speed and replays the selected explanation', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: M.play }));
    expect(panel().getAttribute('data-running')).toBe('true');
    fireEvent.change(screen.getByLabelText(M.speed), { target: { value: '2' } });
    expect(panel().style.getPropertyValue('--topo-duration')).toBe('3s');
    fireEvent.click(screen.getByRole('button', { name: M.pause }));
    expect(panel().getAttribute('data-running')).toBe('false');
    const before = panel().querySelector('.topo-motion__dot');
    fireEvent.click(screen.getByRole('button', { name: M.replay }));
    expect(panel().getAttribute('data-running')).toBe('true');
    expect(panel().querySelector('.topo-motion__dot')).not.toBe(before);
  });

  it('suspends motion while the document is hidden and resumes only the requested play state', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get');
    mount();
    fireEvent.click(screen.getByRole('button', { name: M.play }));
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    expect(panel().getAttribute('data-running')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(M.suspended);
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
    expect(panel().getAttribute('data-running')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: M.pause }));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(panel().getAttribute('data-running')).toBe('false');
  });

  it('honors reduced motion initially and when the preference changes, and cleans up listeners', () => {
    const events = new EventTarget();
    const media = { matches: true, addEventListener: vi.fn(events.addEventListener.bind(events)), removeEventListener: vi.fn(events.removeEventListener.bind(events)) };
    vi.stubGlobal('matchMedia', () => media);
    const view = mount();
    expect((screen.getByRole('button', { name: M.play }) as HTMLButtonElement).disabled).toBe(true);
    expect(panel().querySelector('.topo-motion__dot')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(M.reduced);
    act(() => { media.matches = false; events.dispatchEvent(new Event('change')); });
    fireEvent.click(screen.getByRole('button', { name: M.play }));
    expect(panel().getAttribute('data-running')).toBe('true');
    act(() => { media.matches = true; events.dispatchEvent(new Event('change')); });
    expect(panel().getAttribute('data-running')).toBe('false');
    view.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('shows EXCLUDES as symmetric exclusion with the actual FAIL reason, without a dependency arrow', () => {
    const data = { ...graph, edges: [{ ...graph.edges[0], type: 'EXCLUDES' as const, verdict: 'FAIL' }] };
    mount(data as typeof graph, [{ ...relation, type: 'EXCLUDES', verdict: 'FAIL', rationale: '동일 상품에서 동시에 구성 불가' }]);
    expect(panel().getAttribute('data-verdict')).toBe('FAIL');
    expect(panel().querySelector('.topo-motion__track')?.hasAttribute('marker-end')).toBe(false);
    expect(panel().querySelector('.topo-motion__exclusion')).not.toBeNull();
    expect(panel().querySelector('.topo-motion__dot')).toBeNull();
    expect(within(panel()).getByText(M.excludes)).toBeTruthy();
    expect(within(panel()).getByText('동일 상품에서 동시에 구성 불가')).toBeTruthy();
  });

  it.each(['FAIL', '미판정', 'invalid'])('does not present a PASS when graph and dependency judgement disagree: %s', (verdict) => {
    mount({ ...graph, edges: [{ ...graph.edges[0], verdict: 'PASS' }] }, [{ ...relation, verdict }]);
    expect(panel().getAttribute('data-verdict')).toBe('미판정');
    expect(within(panel()).getByText(M.inconsistent)).toBeTruthy();
  });

  it('selects edges with keyboard and resets the focused explanation to its own evidence', () => {
    const second = { ...graph.edges[0], id: 'DEP-OTHER', verdict: 'FAIL' };
    const data = { ...graph, edges: [...graph.edges, second] };
    function Selection() {
      const [selected, select] = useState(relation.dependencyId);
      return <TopologyGraph data={data} focus={source.featureId} selected={selected} onSelect={select} relations={[relation, { ...relation, dependencyId: second.id, verdict: 'FAIL', rationale: '선택한 다른 관계 근거' }]} />;
    }
    render(<MemoryRouter><Selection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: M.play }));
    fireEvent.keyDown(screen.getByRole('button', { name: M.edge(second.id, second.type, second.verdict) }), { key: ' ' });
    expect(panel().getAttribute('data-running')).toBe('false');
    expect(within(panel()).getByText('선택한 다른 관계 근거')).toBeTruthy();
    expect(panel().getAttribute('data-verdict')).toBe('FAIL');
  });

  it('removes dense network labels while retaining exact accessible node identities and focused names', () => {
    const extra = Array.from({ length: 15 }, (_, i) => ({ id: `F-${i}@1.0`, featureId: `F-${i}`, version: '1.0', name: `긴 이름을 가진 주변 기능 ${i}`, lifecycle: 'RELEASED' }));
    mount({ ...graph, nodes: [...graph.nodes, ...extra] });
    expect(document.querySelectorAll('.ds-topo .ds-topo-label')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'F-14@1.0 긴 이름을 가진 주변 기능 14' })).toBeTruthy();
    expect(within(panel()).getByText(source.name)).toBeTruthy();
    expect(screen.getByText(M.dense)).toBeTruthy();
  });
});
