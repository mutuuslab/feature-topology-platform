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
import { DOMAINS, ITEM, SCREEN_META, canonTitleOf, domainOfPath } from '../i18n';
import { SPEC_MENU } from '../data/specMenu';
import { SCREEN_ENTRY, SCREEN_LINKS, implementedPaths, navPathOfLink, screenOfRoute } from '../data/uiLinks';
import { SCREEN_AREA_BY_ID, SCREEN_AREA_TOTAL, SCREEN_CANON, SCREEN_CANON_BY_ID } from '../data/screenAreas';
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
/**
 * 기준 화면 ID → 메뉴에서 그 화면이 차지한 줄 (없으면 빈 배열).
 * 메뉴는 기준 화면당 한 줄이므로 정상이면 길이 1, 경로는 그 화면의 진입 경로다.
 */
const rowsOf = (id: string) => DOMAINS.flatMap(d => d.screens.filter(s => s.id === id).map(s => ({ key: d.key, s })));

// ─────────────────────────────────────────────────────────────
describe('정본 메뉴 배치 — 30개 화면이 한 번씩, 자기 진입 경로 하나를 갖는다', () => {
  it('기준 화면은 30개이고 모두 구현 경로를 갖는다', () => {
    expect(screenIds).toHaveLength(30);
    screenIds.forEach(id => expect(implementedPaths(id).length, id).toBeGreaterThan(0));
  });

  it('화면 하나가 메뉴 한 줄이고, 그 줄의 경로는 그 화면의 진입 경로다', () => {
    screenIds.forEach(id => {
      const hits = rowsOf(id);
      expect(hits.length, `${id} ${koOf(id)}`).toBe(1);
      expect(hits[0].s.to, id).toBe(SCREEN_ENTRY[id]);
      expect(implementedPaths(id), id).toContain(hits[0].s.to);
    });
  });

  it('메뉴 전체가 30줄 · 30개 서로 다른 경로다 (한 화면이 여러 줄로 늘어서지 않는다)', () => {
    const rows = DOMAINS.flatMap(d => d.screens);
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map(s => s.to)).size).toBe(30);
    expect(rows.map(s => s.id).sort()).toEqual([...screenIds].sort());
  });

  it('업무 그룹 순서와 화면 순서가 MENU 1.3 그대로다', () => {
    DOMAINS.forEach(d => {
      const spec = SPEC_MENU.find(g => g.id === d.key)!;
      expect(d.screens.map(s => s.id), d.key).toEqual(spec.items.map(it => it.id));
      expect(d.screens.map(s => s.ko), d.key).toEqual(spec.items.map(it => it.ko));
    });
  });

  it('메뉴 라벨은 정본 화면 이름이고, 화면 소속 업무 그룹과 레일 해석이 같다', () => {
    DOMAINS.forEach(d => d.screens.forEach(s => {
      expect(s.ko, s.id).toBe(koOf(s.id));
      expect(domainOfPath(s.to), `${d.key} / ${s.id} → ${s.to}`).toBe(d.key);
    }));
  });

  it('화면의 나머지 구현 뷰는 그 화면 안에만 있다 (다른 화면 경로가 섞이지 않는다)', () => {
    const owner = new Map<string, string>();
    Object.keys(SCREEN_LINKS).forEach(id => SCREEN_LINKS[id].links.forEach(l => {
      const to = navPathOfLink(l);
      if (!to.includes(':') && !owner.has(to)) owner.set(to, id);
    }));
    screenIds.forEach(id => rowsOf(id)[0].s.views.forEach(v => {
      expect(owner.get(v.to), `${id} → ${v.to}`).toBe(id);
    }));
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

  it('변경요청(CR) 경로는 변경요청 화면 안에만 있고, 그 화면은 Feature 관리 소속이다', () => {
    const isCrPath = (p: string) => p.startsWith('/change/cr') || p === '/change/timeline';
    const hit = DOMAINS.flatMap(d => d.screens.map(s => ({ key: d.key, s })))
      .filter(x => x.s.views.some(v => isCrPath(v.to)));
    expect(hit).toHaveLength(1);
    expect(hit[0].key).toBe('feature');                 // UI28 은 Feature 관리 소속 (MENU 1.3)
    expect(hit[0].s.id).toBe('UI28');
    expect(hit[0].s.views.map(v => v.to)).toEqual(implementedPaths('UI28'));
  });

  it('Feature 제안 화면에는 변경요청 경로가 하나도 없다', () => {
    expect(rowsOf('UI19')[0].s.views.some(v => v.to.startsWith('/change/'))).toBe(false);
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
describe('정본 화면·상세 영역 표 (screenAreas) 가 모든 화면을 덮는다', () => {
  it('화면 30개 · 상세 영역 186개이고 화면 ID 가 MENU 1.3 과 같다', () => {
    expect(SCREEN_CANON.map(s => s.id).sort()).toEqual([...screenIds].sort());
    expect(SCREEN_AREA_TOTAL).toBe(186);
    expect(Object.keys(SCREEN_AREA_BY_ID)).toHaveLength(186);
  });

  it('영역 ID 는 자기 화면에만 속한다 (UIxx-S0n 의 xx 가 화면 ID)', () => {
    Object.values(SCREEN_AREA_BY_ID).forEach(a => {
      expect(a.id, a.id).toBe(`${a.screenId}-${a.id.split('-')[1]}`);
      expect(SCREEN_CANON_BY_ID[a.screenId], a.screenId).toBeTruthy();
    });
  });

  it('각 화면의 대표 상세 영역(S01)이 있고, 탭 목록이 영역 표 그대로다', () => {
    Object.values(SCREEN_CANON).forEach(s => {
      expect(s.areas.length, s.id).toBeGreaterThan(0);
      expect(s.defaultArea, s.id).toBe(s.areas[0].id);
      expect(s.areas.map(a => a.id).sort(), s.id)
        .toEqual(SCREEN_AREA_BY_ID ? Object.keys(SCREEN_AREA_BY_ID).filter(id => id.startsWith(`${s.id}-`)).sort() : []);
    });
  });

  it('연결표의 areaId 는 모두 그 화면의 정본 영역이다', () => {
    screenIds.forEach(id => {
      SCREEN_LINKS[id].links.forEach(l => {
        if (!l.areaId) return;
        expect(SCREEN_AREA_BY_ID[l.areaId], `${id} ${l.path} → ${l.areaId}`).toBeTruthy();
        expect(SCREEN_AREA_BY_ID[l.areaId].screenId, `${id} ${l.path} → ${l.areaId}`).toBe(id);
      });
    });
  });

  it('화면마다 진입 뷰는 정확히 하나다', () => {
    screenIds.forEach(id => {
      const entries = SCREEN_LINKS[id].links.filter(l => l.entry);
      expect(entries.length, id).toBe(1);
      expect(entries[0].areaId, `${id} 진입 뷰는 정본 영역을 가리킨다`).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe('메뉴 라벨은 정본 영역·화면 이름이고 구현 화면 이름이 아니다', () => {
  it('화면 진입 항목의 이름은 정본 화면 이름이다', () => {
    DOMAINS.forEach(d => d.screens.forEach(s => expect(s.ko, s.id).toBe(koOf(s.id))));
  });

  it('정본 영역이 있는 구현 뷰는 정본 영역 이름을 쓴다', () => {
    Object.keys(SCREEN_LINKS).forEach(id => {
      const per = new Map<string, number>();
      SCREEN_LINKS[id].links.forEach(l => { if (l.areaId) per.set(l.areaId, (per.get(l.areaId) || 0) + 1); });
      SCREEN_LINKS[id].links.forEach(l => {
        // 한 정본 영역을 두 뷰가 나눠 쓰면 구현 이름을 남긴다(아래 테스트가 그 경우를 덮는다).
        if (!l.areaId || (per.get(l.areaId) || 0) > 1) return;
        expect(ITEM[navPathOfLink(l)]?.ko, `${id} ${l.path}`)
          .toBe(SCREEN_AREA_BY_ID[l.areaId].name);
      });
    });
  });

  it('한 화면의 구현 뷰는 서로 다른 이름을 갖는다 (같은 영역을 나눠 써도 구분된다)', () => {
    Object.keys(SCREEN_LINKS).forEach(id => {
      const names = SCREEN_LINKS[id].links.map(l => ITEM[navPathOfLink(l)]?.ko);
      expect(new Set(names).size, `${id} ${names.join(' | ')}`).toBe(names.length);
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe('화면 제목(h1)도 정본 이름을 쓴다', () => {
  it('30개 진입 경로의 제목은 정본 화면 이름이다', () => {
    screenIds.forEach(id => {
      expect(canonTitleOf(SCREEN_ENTRY[id]), `${id} ${SCREEN_ENTRY[id]}`).toBe(koOf(id));
    });
  });

  it('같은 화면의 나머지 구현 뷰는 정본 상세 영역 이름(또는 구현 이름)을 쓴다', () => {
    Object.keys(SCREEN_LINKS).forEach(id => {
      SCREEN_LINKS[id].links.map(navPathOfLink).forEach(p => {
        if (p === SCREEN_ENTRY[id]) return;
        expect(canonTitleOf(p), `${id} ${p}`).toBe(ITEM[p]?.ko);
      });
    });
  });

  it('영어 UI 는 정본 영문 이름을 쓴다', () => {
    screenIds.forEach(id => expect(canonTitleOf(SCREEN_ENTRY[id], 'en'), id).toBe(SCREEN_META[id].en));
  });

  it('대상을 바꿔도 같은 화면이면 같은 정본 영역 이름이다 (예: Feature 상세 = UI02-S07)', () => {
    expect(canonTitleOf('/feature/FEAT-BDC-001')).toBe(SCREEN_AREA_BY_ID['UI02-S07'].name);
    expect(canonTitleOf('/change/cr/CR-2026-0101')).toBe(SCREEN_AREA_BY_ID['UI28-S02'].name);
    expect(canonTitleOf('/topology/FEAT-BDC-001')).toBe(SCREEN_AREA_BY_ID['UI05-S02'].name);
  });

  it('표에 없는 대상 기록은 제목을 화면이 스스로 정한다 (null → 각 화면의 fallback)', () => {
    ['/feature/OTHER-999', '/topology/OTHER-999', '/twin/vehicle/VIN-NOPE']
      .forEach(p => expect(canonTitleOf(p), p).toBeNull());
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
      expect(screen.getAllByText(id).length).toBeGreaterThan(0);
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
