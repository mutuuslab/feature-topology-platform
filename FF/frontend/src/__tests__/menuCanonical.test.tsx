/**
 * 메뉴 정본 배치와 「Feature 제안 ↔ Feature Registry」 경계.
 *
 * 사용자 질문 세 가지에 대한 계약이다.
 *  1. 「Feature 제안」에 왜 변경요청(CR) 화면이 나오나 → 제안 화면과 변경요청 화면은 다른 기준 화면(UI19 / UI28)이고,
 *     메뉴 소속은 그 화면이 **실제로 구현한 경로**로만 정해진다.
 *  2. 「Feature Registry」와 「Feature 제안」의 차이 → Registry(UI02)는 Feature ID·정확 버전을 발급하고
 *     Revision 으로 등록하는 **유일한 생성 경로**이고, 제안(UI19)은 아직 Feature 가 아닌 후보를 접수·검토·이관만 한다.
 *     그래서 제안 화면은 Feature 도 Revision 도 만들지 않는다 — 결정 단계에서 ID 만 발급해 UI02 로 넘긴다.
 *  3. 전체 메뉴 순서 → 정본 MENU 1.3 의 30개 화면이 업무 그룹 순서대로 정확히 한 묶음씩, 자기 경로만 갖는다.
 *
 * 마지막으로 새로 구현한 9개 정본 화면이 6개 상세 영역을 모두 실제 본문으로 갖는지 확인한다.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from '../store';
import { DOMAINS, domainOfPath } from '../i18n';
import { SPEC_MENU } from '../data/specMenu';
import { implementedPaths, screenOfRoute } from '../data/uiLinks';
import { CANON_AREAS } from '../data/canonical';
import { PROPOSAL_TRANSITIONS, SEED_PROPOSALS, proposalGate, type Proposal } from '../data/proposal';
import { ProposalRegistry } from '../pages/propose';
import { DefineRevision } from '../pages/defineRevision';
import { CRList } from '../pages/change';
import { OfferComposition, UpgRegistry, SwStructure } from '../pages/plm';
import { SwEoChange, ProductSpec } from '../pages/eo';
import { IntegrationJobs, DesignTrace } from '../pages/lineage';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

const SCREEN_ITEMS = SPEC_MENU.flatMap(g => g.items);
const screenIds = SCREEN_ITEMS.map(i => i.id);
const koOf = (id: string) => SCREEN_ITEMS.find(i => i.id === id)!.ko;
/** 기준 화면 ID → 그 화면이 서브내비에서 차지한 묶음 (없으면 빈 배열). */
const groupsOf = (id: string) => DOMAINS.flatMap(d => d.groups).filter(g => g.ko === koOf(id));

// ─────────────────────────────────────────────────────────────
describe('정본 메뉴 배치 — 30개 화면이 한 번씩, 자기 경로만 갖는다', () => {
  it('기준 화면은 30개이고 모두 구현 경로를 갖는다', () => {
    expect(screenIds).toHaveLength(30);
    screenIds.forEach(id => expect(implementedPaths(id).length, id).toBeGreaterThan(0));
  });

  it('화면 하나가 묶음 하나이고, 그 안의 경로는 그 화면의 구현 경로 그대로다', () => {
    screenIds.forEach(id => {
      const hits = groupsOf(id);
      expect(hits.length, `${id} ${koOf(id)}`).toBe(1);
      expect(hits[0].items.map(i => i.to), id).toEqual(implementedPaths(id));
    });
  });

  it('업무 그룹 순서와 화면 순서가 MENU 1.3 그대로다', () => {
    DOMAINS.forEach(d => {
      const spec = SPEC_MENU.find(g => g.id === d.key)!;
      const inMenu = spec.items.filter(it => groupsOf(it.id).length > 0).map(it => it.ko);
      expect(d.groups.map(g => g.ko), d.key).toEqual(inMenu);
    });
  });

  it('묶음 제목은 화면 정본 이름이고, 화면 소속 업무 그룹과 레일 해석이 같다', () => {
    DOMAINS.forEach(d => d.groups.forEach(g => g.items.forEach(it => {
      expect(domainOfPath(it.to), `${d.key} / ${g.ko} → ${it.to}`).toBe(d.key);
    })));
  });
});

// ─────────────────────────────────────────────────────────────
describe('변경요청(CR)은 제안 화면이 아니라 변경요청 화면의 것이다', () => {
  it('Feature 제안 화면은 제안 경로 하나만 소유한다', () => {
    expect(implementedPaths('UI19')).toEqual(['/feature/propose']);
  });

  it('변경요청 경로는 전부 변경요청 화면(UI28)으로 해석된다', () => {
    ['/change/cr', '/change/cr/CR-2026-0101', '/change/timeline'].forEach(p => {
      expect(screenOfRoute(p), p).toBe('UI28');
    });
  });

  it('변경요청(CR) 경로는 변경요청 묶음 하나에만 나오고, 그 묶음은 Feature 관리 안에 있다', () => {
    const isCrPath = (p: string) => p.startsWith('/change/cr') || p === '/change/timeline';
    const hit = DOMAINS.flatMap(d => d.groups.map(g => ({ key: d.key, g })))
      .filter(x => x.g.items.some(i => isCrPath(i.to)));
    expect(hit).toHaveLength(1);
    expect(hit[0].key).toBe('feature');                 // UI28 은 Feature 관리 소속 (MENU 1.3)
    expect(hit[0].g.ko).toBe(koOf('UI28'));
    expect(hit[0].g.items.map(i => i.to)).toEqual(implementedPaths('UI28'));
  });

  it('Feature 제안 묶음에는 변경요청 경로가 하나도 없다', () => {
    const proposeGroup = groupsOf('UI19')[0];
    expect(proposeGroup.items.map(i => i.to).some(p => p.startsWith('/change/'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
/** 상태를 문구가 아니라 실제 값으로 읽는 관측점. */
const Probe = () => {
  const { state } = useApp();
  return <div data-testid="probe">{JSON.stringify({
    features: state.features.length,
    revisions: state.revisions.length,
    proposals: (state.proposals as Proposal[]).map(p => ({ id: p.id, stage: p.stage, featureId: p.featureId, route: p.route })),
  })}</div>;
};
const probe = () => JSON.parse(screen.getByTestId('probe').textContent || '{}');

const seedApplication = () => {
  const src = SEED_PROPOSALS.find(p => p.stage === 'RECEIVED')!;
  const Con = () => {
    const { state, dispatch } = useApp();
    const p = (state.proposals as Proposal[]).find(x => x.id === src.id)!;
    return (
      <>
        <button onClick={() => dispatch({ t: 'PROPOSAL_CONVERT', id: p.id, featureId: 'FEAT-BODY-777', reason: '고객 가치·정량 근거 확인', actor: 'author' })}>
          전환
        </button>
        <Link to={`/master/define?from=${p.id}`}>등록 이어하기</Link>
        <span data-testid="seed-id">{src.id}</span>
      </>
    );
  };
  render(
    <MemoryRouter initialEntries={['/']}>
      <AppProvider>
        <Probe />
        <Con />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path="/master/define" element={<DefineRevision />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
  return src.id;
};

describe('Feature 제안 ↔ Feature Registry 경계 (제안은 만들지 않는다)', () => {
  it('Feature 전환은 Feature ID 만 발급하고 Feature·Revision 을 만들지 않는다', () => {
    seedApplication();
    const before = probe();
    fireEvent.click(screen.getByText('전환'));
    const after = probe();
    expect(after.features).toBe(before.features);
    expect(after.revisions).toBe(before.revisions);
    const p = after.proposals.find((x: Proposal) => x.id === 'PRP-2026-0006');
    expect(p.stage).toBe('HANDOFF');
    expect(p.route).toBe('FEATURE');
    expect(p.featureId).toBe('FEAT-BODY-777');
  });

  it('이관된 제안은 UI02 등록 폼에 원천 제안까지 채워 들어간다', () => {
    const src = seedApplication();
    fireEvent.click(screen.getByText('전환'));
    fireEvent.click(screen.getByText('등록 이어하기'));
    expect(screen.getByTestId('ui02-handoff')).toBeInTheDocument();
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value;
    expect(val('reg-FRI-005'), 'Feature 명칭').toBe('좌석 열선 승인 정책 신설');
    expect(val('reg-FRI-037'), '원천 추적').toBe(src);
    expect(val('reg-FRI-025')).toBe('Body Platform Team');
  });

  it('제안 단계에서 결정까지 가려면 접수·검토 조건을 먼저 채워야 한다', () => {
    const p = SEED_PROPOSALS.find(x => x.kind === 'CHANGE' && x.stage === 'DRAFT')!;
    // 초안 → 접수: 정량 근거 없이는 거부된다.
    const noEvidence: Proposal = { ...p, quantitative: '' };
    const g1 = proposalGate(noEvidence, 'RECEIVED');
    expect(g1.ok).toBe(false);
    expect(g1.reasons.join(' ')).toContain('정량 근거');
    // 근거를 채우면 접수가 열린다.
    expect(proposalGate(p, 'RECEIVED').ok).toBe(true);
    // 검토는 접수 ACK 와 기술 검토자가 함께 있어야 열린다.
    const received: Proposal = { ...p, stage: 'RECEIVED', handoff: { correlationId: 'c', commandId: 'm', requestedAt: '2026-09-14 10:00', state: 'REQUESTED', receiver: 'Conn. Team' } };
    expect(proposalGate(received, 'REVIEWING').ok).toBe(false);
    expect(proposalGate({ ...received, handoff: { ...received.handoff!, state: 'ACKED' }, reviewer: 'quality' }, 'REVIEWING').ok).toBe(true);
    // 이관은 Feature 전환 경로 + 발급 ID 가 함께 있어야 성립한다(보류·반려는 이관으로 가지 않는다).
    const decided: Proposal = { ...received, stage: 'DECISION', route: 'FEATURE', featureId: '' };
    expect(proposalGate(decided, 'HANDOFF').ok).toBe(false);
    expect(proposalGate({ ...decided, featureId: 'FEAT-CONN-001' }, 'HANDOFF').ok).toBe(true);
    expect(proposalGate({ ...decided, route: 'HOLD' }, 'HANDOFF').ok).toBe(false);
    expect(PROPOSAL_TRANSITIONS.HANDOFF).toEqual([]);
    expect(PROPOSAL_TRANSITIONS.REJECTED).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
describe('새 정본 화면은 6개 상세 영역을 모두 실제 본문으로 갖는다', () => {
  const SCREENS: { id: string; path: string; el: React.ReactNode }[] = [
    { id: 'UI19', path: '/feature/propose', el: <ProposalRegistry /> },
    { id: 'UI28', path: '/change/cr', el: <CRList /> },
    { id: 'UI07', path: '/commerce/offer', el: <OfferComposition /> },
    { id: 'UI21', path: '/master/upg', el: <UpgRegistry /> },
    { id: 'UI22', path: '/master/structure', el: <SwStructure /> },
    { id: 'UI23', path: '/change/eo', el: <SwEoChange /> },
    { id: 'UI24', path: '/master/product-spec', el: <ProductSpec /> },
    { id: 'UI26', path: '/integration/jobs', el: <IntegrationJobs /> },
    { id: 'UI30', path: '/trace/design', el: <DesignTrace /> },
  ];

  it('영역 표에 9개 화면 × 6개 영역이 있다', () => {
    expect(SCREENS.map(s => s.id).sort()).toEqual(Object.keys(CANON_AREAS).sort());
    Object.values(CANON_AREAS).forEach(a => expect(a).toHaveLength(6));
  });

  SCREENS.forEach(({ id, path, el }) => {
    it(`${id} 화면 — 영역 6개가 모두 채워져 있고 화면 ID·정본 영역 이름이 일치한다`, () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppProvider><Routes><Route path={path} element={el} /></Routes></AppProvider>
        </MemoryRouter>,
      );
      expect(screen.getByText(id)).toBeInTheDocument();
      const areas = CANON_AREAS[id];
      areas.forEach(a => {
        const tab = screen.getByRole('button', { name: new RegExp(a.name) });
        expect(tab, `${id} ${a.id}`).toBeInTheDocument();
        fireEvent.click(tab);
        expect(document.body.textContent, `${id} ${a.id}`).toContain(`${a.id} · ${a.name}`);
        expect(document.body.textContent, `${id} ${a.id}`).not.toContain('영역 본문이 연결되지 않았다');
      });
      // 본문이 빠진 영역은 탭에 ⚠ 로 표시된다 — 아무 영역도 빠지면 안 된다.
      expect(document.body.textContent).not.toContain('⚠');
    });
  });
});
