// Feature BOM 기준선 (승인 구성) — 운영 데이터 계층
//
// 기준 정본
//  · Feature_Topology_Definition v0.8 §2 — Feature BOM 은 승인 대상 Feature 버전 집합과 선택 구현 참조를
//    고정한 상위 구성 기준선이고, ImplementationBOM 은 하나의 FeatureVersion 을 구현하는 정확 구성이다.
//    승인 BOM 안에 대안 기능이 함께 존재할 수 있으며 그 자체로 모든 기능을 동시에 활성화하지 않는다.
//  · FP_SW_Detailed_Design v4.6 · MODEL BOMBaseline — id, version, members(중복 금지), implementationBoms,
//    items(부모는 동일 기준선에 속해야 함), contentHash(SHA256 자동), assessmentRef(승인 시),
//    approval(작성자와 별도 주체·시각·사유), predecessor(변경 시), revokedAt(철회 시)
//  · DD-03-3 — Item 합집합·중복·출처·resolution 검사 후 contentHash 생성.
//    현재 hash 의 Assessment 와 독립 승인자를 결속하고 상태와 승인 기록만 갱신한다.
//  · DD-03-4 / UL-017 — ConditionRow 는 market·model·modelYear·trim·option·HW·SW·UPG VC 결합이며
//    배열을 교차곱으로 전개하지 않는다. 행 안은 AND, 행 사이는 OR. 초기 저장 호환 프로파일은
//    동일 BOMBaseline 내 FeatureVersion당 구현 하나를 유지하며 다른 구현은 별도 조건별 BOM 으로 작성한다.
//  · DD-03-3 확장 경계 — Master·Configured·Effective 는 표현이며 파생 view 를 원천 승인 데이터로 되쓰지 않는다.
//  · C03 Feature BOM · 구성·의존관계 관리 — 실패코드 IMPLEMENTATION_ITEM_DRIFT, UNRESOLVED_ARTIFACT
//
// 승인 차단은 문장이 아니라 필드에서 계산한다. 화면은 이 계산 결과만 보여준다.
import {
  BOM_AREAS, BOM_AREA_KO, IMPL_BOM_INDEX,
  type BomArea, type Resolution,
} from './implementation';
import { sha256Hex } from './sha256';

export type BaselineState = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REVOKED';

export const BASELINE_STATES: BaselineState[] = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REVOKED'];

export const BASELINE_STATE_KO: Record<BaselineState, string> = {
  DRAFT: '작성 중', IN_REVIEW: '검토 중', CHANGES_REQUESTED: '보완 요청', APPROVED: '승인', REVOKED: '철회',
};

export const BASELINE_STATE_TONE: Record<BaselineState, string> = {
  DRAFT: 'pending', IN_REVIEW: 'pending', CHANGES_REQUESTED: 'fail', APPROVED: 'pass', REVOKED: 'muted',
};

// ── 구성원 (UI04-S02 Feature 구성원 7열) ──
export interface BaselineMember {
  memberId: string;
  /** 부모 또는 Feature — 최상위 멤버는 자기 자신을 가리킨다. */
  parentRef: string;
  featureVersionRef: string;
  /** 멤버별 구현 참조 — implementationRef → featureVersionRef 정합이 필요하다. */
  implementationRef: string;
  conditionProfileRef: string;
  quantity: number;
}

// ── 기준선 Item (UI04-S03 구현 구성과 11개 영역) ──
export interface BaselineItem {
  id: string;
  area: BomArea;
  /** 이 Item 이 속한 구성원 — 동일 기준선 밖이면 승인 차단이다. */
  parentRef: string;
  valueRef: string;
  resolution: Resolution;
}

export interface AssessmentRef { id: string; hashRef: string; result: 'PASS' | 'FAIL' | 'CONDITIONAL'; harness: string; at: string }
export interface ApprovalRef { actor: string; role: string; at: string; reason: string; contentHashRef: string }

interface ApprovalSeed extends Omit<ApprovalRef, 'contentHashRef'> {
  /** CURRENT = 현재 내용의 hash 로 승인, STALE = 승인 후 내용이 바뀌어 hash 불일치 */
  hashState: 'CURRENT' | 'STALE';
}

interface BomBaselineSeed {
  id: string;
  version: string;
  /** 기준선 범위 (필수) */
  memberSetRef: string;
  /** 책임자 ref (필수) */
  ownerRef: string;
  author: string;
  state: BaselineState;
  members: BaselineMember[];
  /** 구성원의 ImplementationBOM 11개 영역에서 파생한 Item — 부모는 이 기준선의 구성원이다. */
  extraItems?: BaselineItem[];
  /** Topology node 집합 — 이 Feature 집합이 BOM 멤버와 일치해야 한다. */
  topologyRef: string;
  topologyNodes: string[];
  assessmentRef?: AssessmentRef;
  approval?: ApprovalSeed;
  predecessor?: string;
  changeReason?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface BomBaseline extends Omit<BomBaselineSeed, 'extraItems' | 'approval'> {
  items: BaselineItem[];
  /** 내용에서 계산한 SHA-256 64자리 — 승인·평가·증적의 결속 기준 */
  contentHash: string;
  approval?: ApprovalRef;
}

/** 구성원의 ImplementationBOM 11개 영역을 Item 으로 전개한다. 해석되지 않는 구성원은 UNRESOLVED 로 남는다. */
function baselineItems(member: BaselineMember): BaselineItem[] {
  const impl = IMPL_BOM_INDEX.get(member.implementationRef);
  return BOM_AREAS.map(area => {
    const it = impl?.items.find(i => i.area === area);
    return {
      id: `${member.memberId}-${member.conditionProfileRef}-${area}`,
      area,
      parentRef: member.featureVersionRef,
      valueRef: !it ? '—' : it.presence === 'PRESENT' ? it.refs.join(', ') : 'NOT_APPLICABLE',
      resolution: (!it || it.presence === 'PRESENT' && it.resolution !== 'RESOLVED' ? 'UNRESOLVED' : 'RESOLVED') as Resolution,
    };
  });
}

/** contentHash 입력의 정규 직렬화 — 상태·승인 기록은 내용이 아니므로 제외한다. */
const canonical = (b: Pick<BomBaseline, 'members' | 'items'>) => JSON.stringify({
  members: [...b.members]
    .map(m => [m.memberId, m.parentRef, m.featureVersionRef, m.implementationRef, m.conditionProfileRef, m.quantity])
    .sort(),
  items: [...b.items].map(i => [i.id, i.area, i.parentRef, i.valueRef, i.resolution]).sort(),
});

/** 승인·평가·증적이 결속되는 기준선 내용 hash. */
export const bomContentHash = (b: Pick<BomBaseline, 'members' | 'items'>) => sha256Hex(canonical(b));

const M = (
  memberId: string, featureVersionRef: string, implementationRef: string,
  conditionProfileRef: string, parentRef?: string, quantity = 1,
): BaselineMember => ({ memberId, parentRef: parentRef || featureVersionRef, featureVersionRef, implementationRef, conditionProfileRef, quantity });

const SEEDS: BomBaselineSeed[] = [
  // 승인 완료 — 별도 승인자, 현재 hash 의 검증 결과, 구성원 전원 해석 완료
  {
    id: 'BL-LIGHT-ADAS-2027.1', version: '1.0.0', state: 'APPROVED',
    memberSetRef: 'ADAS 종방향 보조 + 실내 조명 안무 — KR 한정 승인 구성',
    ownerRef: 'ROLE:feature-designer@vehicle', author: 'kim.taeho@body',
    members: [
      M('MBR-ADAS-001', 'FEAT-ADAS-001@2.4.0', 'IBOM-ADAS-001@2.0.0', 'AP-KR-A@1'),
      M('MBR-LIGHT-001', 'FEAT-LIGHT-001@2.0.0', 'IBOM-LIGHT-001@2.0.0', 'AP-KR-A@1'),
    ],
    topologyRef: 'TOPO-ADAS-LIGHT@1.2.0',
    topologyNodes: ['FEAT-ADAS-001@2.4.0', 'FEAT-LIGHT-001@2.0.0'],
    assessmentRef: { id: 'ASM-LIGHT-ADAS-0421', hashRef: 'CURRENT', result: 'PASS', harness: 'HIL-LIGHT-03 + HIL-ADAS-07', at: '2026-09-11 17:20' },
    approval: { actor: 'lee.jihyun@quality', role: 'approver', at: '2026-09-12 09:05', reason: '승인 범위와 11개 영역 근거 확인 — 독립 승인', hashState: 'CURRENT' },
    changeReason: '신규 승인 — 대안 기능 2건을 동시 활성화하지 않는 구성 기준선',
  },
  // 검토 중 — 현재 hash 의 검증 결과가 있고 승인 기록이 없어 승인 게이트를 실제로 통과할 수 있다
  {
    id: 'BL-LIGHT-2027.1', version: '1.0.0', state: 'IN_REVIEW',
    memberSetRef: 'Welcome Light Choreography — MY2027 승인 후보 구성',
    ownerRef: 'ROLE:feature-designer@vehicle', author: 'kim.taeho@body',
    members: [M('MBR-LIGHT-001', 'FEAT-LIGHT-001@2.0.0', 'IBOM-LIGHT-001@2.0.0', 'AP-KR-LIGHT@1')],
    topologyRef: 'TOPO-LIGHT@1.0.0',
    topologyNodes: ['FEAT-LIGHT-001@2.0.0'],
    assessmentRef: { id: 'ASM-LIGHT-0391', hashRef: 'CURRENT', result: 'PASS', harness: 'HIL-LIGHT-03', at: '2026-09-12 09:40' },
    changeReason: '시퀀스 24건 확정 — 승인 요청',
  },
  // 검토 중 — 승인 후보가 올라온 뒤 항목이 바뀌어 hash 가 어긋난 상태
  {
    id: 'BL-BDC-2027.1', version: '1.0.0', state: 'IN_REVIEW',
    memberSetRef: 'BDC 도어 정책 MY2027 반영 — KR/EU 승인 후보 구성',
    ownerRef: 'ROLE:feature-designer@body', author: 'kim.taeho@body',
    members: [M('MBR-BDC-001', 'FEAT-BDC-001@1.1.0', 'IBOM-BDC-001@1.1.0', 'AP-KR-A@1')],
    topologyRef: 'TOPO-BDC-BODY@3.1.0',
    topologyNodes: ['FEAT-BDC-001@1.1.0'],
    approval: { actor: 'park.minsoo@quality', role: 'approver', at: '2026-09-10 11:40', reason: '1차 검토 승인', hashState: 'STALE' },
    changeReason: 'MY2027 Variant 규칙과 HIL 42케이스 반영',
  },
  // 작성 중 — 이전 기준선의 후속 개정, 복수 구현과 미등록 구현 참조가 남아 있다
  {
    id: 'BL-BDC-2027.2', version: '2.0.0', state: 'DRAFT',
    memberSetRef: 'BDC 도어 정책 MY2027 — 조건별 구현 분리 작성',
    ownerRef: 'ROLE:feature-designer@body', author: 'kim.taeho@body',
    members: [
      M('MBR-KR-BDC', 'FEAT-BDC-001@1.1.0', 'IBOM-BDC-001@1.1.0', 'AP-KR-A@1'),
      M('MBR-EU-BDC', 'FEAT-BDC-001@1.1.0', 'IBOM-BDC-001@1.0.0', 'AP-EU-B@1'),
      M('MBR-ADAS', 'FEAT-ADAS-001@2.4.0', 'IBOM-ADAS-001@2.1.0', 'AP-KR-A@1'),
    ],
    topologyRef: 'TOPO-BDC-BODY@3.2.0',
    topologyNodes: ['FEAT-BDC-001@1.1.0', 'FEAT-ADAS-001@2.4.0', 'FEAT-PARK-001@1.0.0'],
    predecessor: 'BL-BDC-2027.1@1.0.0',
    changeReason: 'KR/EU 구현 선택을 조건별 BOM 으로 분리',
  },
  // 보완 요청 — 하위 버전 변경과 조건 Profile 미등록이 남아 승인 불가
  {
    id: 'BL-ADAS-2027.1', version: '1.0.0', state: 'CHANGES_REQUESTED',
    memberSetRef: 'ADAS 종방향 보조 — ASIL B 트림 승인 구성',
    ownerRef: 'ROLE:feature-designer@vehicle', author: 'jung.hana@adas',
    members: [
      M('MBR-ADAS-A', 'FEAT-ADAS-001@2.4.0', 'IBOM-ADAS-001@2.0.0', 'AP-KR-A2@9'),
      M('MBR-ADAS-A', 'FEAT-ADAS-001@2.4.0', 'IBOM-ADAS-001@2.0.0', 'AP-KR-A@1'),
    ],
    extraItems: [
      { id: 'MBR-ADAS-A-Requirement', area: 'Requirement', parentRef: 'FEAT-ADAS-001@2.3.0', valueRef: 'ART-SWE-ADAS-001@2.4.0', resolution: 'RESOLVED' },
    ],
    topologyRef: 'TOPO-ADAS-LONG@2.0.0',
    topologyNodes: ['FEAT-ADAS-001@2.4.0'],
    assessmentRef: { id: 'ASM-ADAS-0390', hashRef: 'CURRENT', result: 'CONDITIONAL', harness: 'HIL-ADAS-07', at: '2026-09-09 15:12' },
    changeReason: '보완 요청 — 하위 버전 참조 1건, 조건 Profile 미등록 1건',
  },
  // 철회 — 자기 승인이었고 승인 후 구성이 바뀌어 hash 가 남지 않았다
  {
    id: 'BL-BDC-2026.4', version: '4.0.0', state: 'REVOKED', revokedAt: '2026-04-11 14:02',
    revokedReason: 'MY2026.4 후속 개정으로 철회 — 승인 hash 불일치 확인',
    memberSetRef: 'BDC 도어 정책 MY2026.4 — 철회된 승인 구성',
    ownerRef: 'ROLE:feature-designer@body', author: 'kim.taeho@body',
    members: [M('MBR-BDC-LEGACY', 'FEAT-BDC-001@1.0.0', 'IBOM-BDC-001@1.0.0', 'AP-KR-A@1')],
    topologyRef: 'TOPO-BDC-BODY@2.9.0',
    topologyNodes: ['FEAT-BDC-001@1.0.0'],
    approval: { actor: 'kim.taeho@body', role: 'approver', at: '2026-03-28 16:30', reason: '당시 승인', hashState: 'STALE' },
  },
];

export const BOM_BASELINES: BomBaseline[] = SEEDS.map(seed => {
  const { extraItems, approval, ...rest } = seed;
  const items = [...rest.members.flatMap(baselineItems), ...(extraItems || [])];
  const contentHash = bomContentHash({ members: rest.members, items });
  return {
    ...rest, items, contentHash,
    approval: approval && {
      actor: approval.actor, role: approval.role, at: approval.at, reason: approval.reason,
      contentHashRef: approval.hashState === 'CURRENT'
        ? contentHash
        // 승인 시점의 내용 hash — 실제로 계산한 값이며 현재 내용과 다르다.
        : bomContentHash({
          members: rest.members,
          items: items.map(i => (i.id.endsWith('-Requirement') ? { ...i, valueRef: `${i.valueRef} (승인 시점)` } : i)),
        }),
    },
  };
});

export const BASELINE_INDEX = new Map(BOM_BASELINES.map(b => [`${b.id}@${b.version}`, b]));

/** 멤버별 구현 구성 FK — 각 멤버의 implementationRef 정합성 검사 대상. */
export const implementationBomsOf = (b: BomBaseline) =>
  [...new Set(b.members.map(m => m.implementationRef))]
    .map(ref => ({ ref, bom: IMPL_BOM_INDEX.get(ref) }));

// ── 기준선 위반 (승인 차단 사유) ──
export type BomViolationCode =
  | 'MEMBER_OUTSIDE_BASELINE' | 'DUPLICATE_MEMBER' | 'MULTI_IMPLEMENTATION_MEMBER'
  | 'IMPL_BOM_UNKNOWN' | 'UNRESOLVED_ITEM' | 'BOM_TOPOLOGY_MISMATCH'
  | 'ASSESSMENT_REQUIRED' | 'SELF_APPROVAL' | 'HASH_MISMATCH' | 'CONFIG_CONFLICT';

export interface BomViolation { code: BomViolationCode; target: string; detail: string; blocking: boolean }

export function computeBaselineViolations(baselines: BomBaseline[] = BOM_BASELINES): BomViolation[] {
  const out: BomViolation[] = [];

  baselines.forEach(b => {
    const ref = `${b.id}@${b.version}`;
    const memberIds = new Set<string>();
    b.members.forEach(m => {
      if (memberIds.has(m.memberId)) {
        out.push({ code: 'DUPLICATE_MEMBER', target: `${ref} → ${m.memberId}`, detail: '같은 구성원 ID 가 두 번 존재 — 승인 Feature 집합은 중복을 금지한다', blocking: true });
      }
      memberIds.add(m.memberId);
    });

    // UL-017 — 동일 BOMBaseline 안에서 FeatureVersion 당 구현 하나를 유지한다
    const byFeature = new Map<string, Set<string>>();
    b.members.forEach(m => byFeature.set(m.featureVersionRef, (byFeature.get(m.featureVersionRef) || new Set()).add(m.implementationRef)));
    byFeature.forEach((impls, feature) => {
      if (impls.size > 1) {
        out.push({
          code: 'MULTI_IMPLEMENTATION_MEMBER', target: `${ref} → ${feature}`,
          detail: `한 기준선에 구현 ${impls.size}개(${[...impls].join(', ')}) — 다른 구현은 별도 조건별 BOM 으로 작성해야 한다`,
          blocking: true,
        });
      }
    });

    // 멤버 구현 참조 정합성 (C03 — implementationRef → featureVersionRef)
    const unknownImplMembers = new Set<string>();
    b.members.forEach(m => {
      const impl = IMPL_BOM_INDEX.get(m.implementationRef);
      if (!impl) {
        unknownImplMembers.add(m.memberId);
        out.push({ code: 'IMPL_BOM_UNKNOWN', target: `${ref} → ${m.memberId}`, detail: `구현 구성 ${m.implementationRef} 를 레지스트리에서 해석할 수 없음`, blocking: true });
      } else if (impl.featureRef !== m.featureVersionRef) {
        out.push({ code: 'MEMBER_OUTSIDE_BASELINE', target: `${ref} → ${m.memberId}`, detail: `구현 구성의 featureRef(${impl.featureRef}) 가 멤버 버전(${m.featureVersionRef}) 과 다름`, blocking: true });
      }
      if (!CONDITION_ROWS_BY_REF.has(m.conditionProfileRef)) {
        out.push({ code: 'CONFIG_CONFLICT', target: `${ref} → ${m.memberId}`, detail: `조건 Profile ${m.conditionProfileRef} 를 해석할 수 없음 — 구현 선택을 판정할 수 없다`, blocking: true });
      }
    });

    // BOMItem — 부모는 동일 기준선에 속해야 한다
    const parentRefs = new Set<string>([...b.members.map(m => m.featureVersionRef), ...b.members.map(m => m.memberId)]);
    b.items.forEach(it => {
      if (!parentRefs.has(it.parentRef)) {
        out.push({ code: 'MEMBER_OUTSIDE_BASELINE', target: `${ref} → ${it.id}`, detail: `Item 부모(${it.parentRef}) 가 이 기준선의 구성원이 아님`, blocking: true });
      }
      // 구현 구성 자체를 해석할 수 없는 멤버의 Item 은 IMPL_BOM_UNKNOWN 하나로 보고한다.
      const owner = b.members.find(m => it.parentRef === m.featureVersionRef || it.parentRef === m.memberId);
      if (it.resolution !== 'RESOLVED' && !(owner && unknownImplMembers.has(owner.memberId))) {
        out.push({ code: 'UNRESOLVED_ITEM', target: `${ref} → ${it.parentRef}/${BOM_AREA_KO[it.area]}`, detail: '구성 영역의 정확 참조를 해석할 수 없음 — 승인 차단', blocking: true });
      }
    });

    // Topology node 집합과 BOM 멤버가 일치해야 한다
    const members = new Set(b.members.map(m => m.featureVersionRef));
    const nodes = new Set(b.topologyNodes);
    const onlyNodes = [...nodes].filter(n => !members.has(n));
    const onlyMembers = [...members].filter(n => !nodes.has(n));
    if (onlyNodes.length || onlyMembers.length) {
      out.push({
        code: 'BOM_TOPOLOGY_MISMATCH', target: `${ref} → ${b.topologyRef}`,
        detail: [onlyNodes.length ? `Topology 에만 있는 node ${onlyNodes.join(', ')}` : '', onlyMembers.length ? `BOM 에만 있는 멤버 ${onlyMembers.join(', ')}` : ''].filter(Boolean).join(' · '),
        blocking: true,
      });
    }

    // 승인 시 필수 — 현재 hash 의 검증 결과
    if (b.state === 'IN_REVIEW' || b.state === 'APPROVED') {
      if (!b.assessmentRef) {
        out.push({ code: 'ASSESSMENT_REQUIRED', target: `${ref} → assessmentRef`, detail: '현재 hash 의 검증 결과가 없음', blocking: true });
      } else if (b.assessmentRef.hashRef !== 'CURRENT' && b.assessmentRef.hashRef !== b.contentHash) {
        out.push({ code: 'HASH_MISMATCH', target: `${ref} → assessmentRef`, detail: '검증 결과가 현재 contentHash 의 것이 아님 — 재검증 필요', blocking: true });
      }
    }

    if (b.approval) {
      if (b.approval.actor === b.author) {
        out.push({ code: 'SELF_APPROVAL', target: `${ref} → ${b.approval.actor}`, detail: '승인자가 작성자와 같은 주체 — 별도 승인자가 승인해야 한다', blocking: true });
      }
      if (b.approval.contentHashRef !== b.contentHash) {
        out.push({ code: 'HASH_MISMATCH', target: `${ref} → approval`, detail: '승인 후보의 내용 hash 가 승인 기록과 다름 — 새 버전과 재검토로 이어진다', blocking: true });
      }
    }
  });

  // 같은 사유가 여러 구성원에서 반복되면 한 번만 보고한다.
  const seen = new Set<string>();
  return out.filter(v => {
    const key = `${v.code}|${v.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const baselineViolationsOf = (b: BomBaseline, all: BomViolation[] = BOM_VIOLATIONS) =>
  all.filter(v => v.target.startsWith(`${b.id}@${b.version}`));

// ── 조건 Profile (DD-03-4 · UL-017) ──
// 각 행의 조건은 AND, 행 사이는 OR. 배열을 교차곱으로 전개하지 않는다.
// NULL(''), ANY, NOT_APPLICABLE, UNKNOWN 은 구별한다.
export const CONDITION_AXES = ['market', 'model', 'modelYear', 'trim', 'option', 'hw', 'sw', 'upgvc'] as const;
export type ConditionAxis = (typeof CONDITION_AXES)[number];

export interface ConditionRow extends Record<ConditionAxis, string> {
  id: string;
  version: string;
  implementationRef: string;
}

export const BOM_CONDITION_PROFILES: ConditionRow[] = [
  { id: 'AP-KR-A', version: '1', market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-B', sw: 'ANY', upgvc: 'UPGVC-X', implementationRef: 'IBOM-BDC-001@1.1.0' },
  { id: 'AP-EU-B', version: '1', market: 'EU', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-C', sw: 'ANY', upgvc: 'UPGVC-Y', implementationRef: 'IBOM-BDC-001@1.1.0' },
  { id: 'AP-KR-LIGHT', version: '1', market: 'KR', model: 'ADAS-LIGHT', modelYear: 'MY2027+', trim: 'ANY', option: 'NOT_APPLICABLE', hw: 'ANY', sw: 'ANY', upgvc: 'UPGVC-X', implementationRef: 'IBOM-LIGHT-001@2.0.0' },
  { id: 'AP-KR-ADAS', version: '1', market: 'KR', model: 'ADAS-LONG', modelYear: 'MY2027+', trim: 'ANY', option: 'NOT_APPLICABLE', hw: 'ANY', sw: 'ANY', upgvc: 'UPGVC-X', implementationRef: 'IBOM-ADAS-001@2.0.0' },
  // AP-KR-A@1 과 같은 조건을 만족하면서 다른 구현을 선택하는 중복 행 — CONFIG_CONFLICT 근거 (UL-AC-017)
  { id: 'AP-KR-A2', version: '2', market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-B', sw: 'ANY', upgvc: 'UPGVC-X', implementationRef: 'IBOM-BDC-001@1.0.0' },
  // 필수 입력을 모르는 상태 — 정규화 대상으로 남기고 임의 우선순위를 만들지 않는다
  { id: 'AP-UNKNOWN-TRIM', version: '1', market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'UNKNOWN', option: 'ANY', hw: 'ANY', sw: 'ANY', upgvc: 'UPGVC-X', implementationRef: 'IBOM-BDC-001@1.1.0' },
];

const CONDITION_ROWS_BY_REF = new Map(BOM_CONDITION_PROFILES.map(r => [`${r.id}@${r.version}`, r]));

export type BomContext = Partial<Record<ConditionAxis, string>>;
export type ProfileOutcome = 'SELECTED' | 'NOT_SUPPORTED' | 'UNVERIFIED' | 'CONFIG_CONFLICT';

export interface ProfileResult {
  outcome: ProfileOutcome;
  implementationRef?: string;
  matched: string[];
  reason: string;
}

const NO_CONSTRAINT = new Set(['', 'ANY', 'NOT_APPLICABLE']);
const isUnknownValue = (v?: string) => v === undefined || v === '' || v === 'UNKNOWN';

function rowMatch(row: ConditionRow, ctx: BomContext): { match: boolean; unknown: boolean } {
  let unknown = false;
  for (const axis of CONDITION_AXES) {
    const want = row[axis];
    if (want === 'UNKNOWN') { unknown = true; continue; }
    if (NO_CONSTRAINT.has(want)) continue;
    const have = ctx[axis];
    if (isUnknownValue(have)) { unknown = true; continue; }
    if (have !== want) return { match: false, unknown: false };
  }
  return { match: true, unknown };
}

/**
 * 승인된 조건 Profile 에서 구현 선택을 판정한다.
 * 필수값이 UNKNOWN 이면 신규 활성화를 보류하고, 여러 행이 참이고 서로 다른 구현을 선택하면
 * 임의로 첫 행을 고르지 않고 CONFIG_CONFLICT 로 남긴다.
 */
export function evaluateProfiles(context: BomContext, rows: ConditionRow[] = BOM_CONDITION_PROFILES): ProfileResult {
  const certain: ConditionRow[] = [];
  const uncertain: ConditionRow[] = [];
  rows.forEach(row => {
    const r = rowMatch(row, context);
    if (!r.match) return;
    (r.unknown ? uncertain : certain).push(row);
  });

  // 확정 판정이 가능한 행이 있으면 그 행들만으로 구현을 고른다. 보류 행은 사유에 남긴다.
  if (certain.length > 0) {
    const impls = [...new Set(certain.map(r => r.implementationRef))];
    const refs = certain.map(r => `${r.id}@${r.version}`);
    if (impls.length > 1) {
      return {
        outcome: 'CONFIG_CONFLICT', matched: refs,
        reason: `참인 행 ${refs.join(', ')} 가 서로 다른 구현(${impls.join(', ')})을 선택 — 임의 우선순위를 만들지 않는다`,
      };
    }
    return {
      outcome: 'SELECTED', implementationRef: impls[0], matched: refs,
      reason: `정확 구현 ${impls[0]} 선택 · 조건 ${refs.join(', ')}` +
        (uncertain.length ? ` · 확인 보류 행 ${uncertain.map(r => `${r.id}@${r.version}`).join(', ')}` : ''),
    };
  }

  return uncertain.length > 0
    ? {
      outcome: 'UNVERIFIED', matched: uncertain.map(r => `${r.id}@${r.version}`),
      reason: `필수 조건 입력이 UNKNOWN — 신규 활성화 보류 (${uncertain.map(r => `${r.id}@${r.version}`).join(', ')})`,
    }
    : { outcome: 'NOT_SUPPORTED', matched: [], reason: '조건을 만족하는 Profile 행이 없음' };
}

export const PROFILE_OUTCOME_KO: Record<ProfileOutcome, string> = {
  SELECTED: '구현 선택', NOT_SUPPORTED: '지원 없음', UNVERIFIED: '확인 보류', CONFIG_CONFLICT: '조건 충돌',
};

// 조건 Profile 표를 모두 정의한 뒤에 계산한다 — 조합 판정이 이 표를 참조한다.
export const BOM_VIOLATIONS = computeBaselineViolations();

// ── Master / Configured / Effective 표현 (파생 view — 원천 승인 데이터로 되쓰지 않는다) ──
export type BomViewKind = 'MASTER' | 'CONFIGURED' | 'EFFECTIVE';

export interface BomViewRow {
  key: string;
  label: string;
  baselineValue: string;
  viewValue: string;
  impact: string;
  review: 'NONE' | 'REVIEW' | 'BLOCKED';
}

export interface BomView { kind: BomViewKind; title: string; note: string; readOnly: true; rows: BomViewRow[] }

export const BOM_VIEW_KO: Record<BomViewKind, string> = {
  MASTER: 'Master — 승인 구성', CONFIGURED: 'Configured — 시장·상품·조건 view', EFFECTIVE: 'Effective — 설치·권리·관측 시점 view',
};

export function buildBomViews(b: BomBaseline, context: BomContext, observations: Record<string, string | number | boolean> = {}): BomView[] {
  const profile = evaluateProfiles(context);

  const master: BomView = {
    kind: 'MASTER', readOnly: true, title: BOM_VIEW_KO.MASTER,
    note: '승인된 구성 집합 자체 — 원천이며 이 view 에서 값을 바꾸지 않는다.',
    rows: b.members.map(m => ({
      key: m.memberId, label: `${m.featureVersionRef} 구현`, baselineValue: m.implementationRef, viewValue: m.implementationRef,
      impact: `조건 Profile ${m.conditionProfileRef} · 수량 ${m.quantity}`, review: 'NONE',
    })),
  };

  const configured: BomView = {
    kind: 'CONFIGURED', readOnly: true, title: BOM_VIEW_KO.CONFIGURED,
    note: '시장·상품·조건으로 생성한 view 다. 파생 값을 원천 승인 데이터로 되쓰지 않는다.',
    rows: b.members.map(m => {
      const selected = profile.outcome === 'SELECTED' && profile.implementationRef;
      const blocked = profile.outcome === 'CONFIG_CONFLICT' || profile.outcome === 'NOT_SUPPORTED';
      return {
        key: m.memberId, label: `${m.featureVersionRef} 구현 선택`,
        baselineValue: m.implementationRef,
        viewValue: selected ? profile.implementationRef as string : `${PROFILE_OUTCOME_KO[profile.outcome]} (${profile.matched.join(', ') || '—'})`,
        impact: profile.reason,
        review: blocked ? 'BLOCKED' as const : profile.outcome === 'UNVERIFIED' ? 'REVIEW' as const : 'NONE' as const,
      };
    }),
  };

  const effective: BomView = {
    kind: 'EFFECTIVE', readOnly: true, title: BOM_VIEW_KO.EFFECTIVE,
    note: '설치·권리·실제 관측을 결합한 시점 view 다. 관측은 실행 권한이 아니다.',
    rows: b.members.map(m => {
      const impl = IMPL_BOM_INDEX.get(m.implementationRef);
      const control = impl?.items.find(i => i.area === 'Control');
      const observed = control ? control.refs.map(r => `${r}=${observations[r] ?? '미보고'}`).join(' · ') : '제어점 계약 없음';
      return {
        key: m.memberId, label: `${m.featureVersionRef} 제어 계약`,
        baselineValue: control ? control.refs.join(', ') : '—',
        viewValue: observed,
        impact: control ? '관측값은 실행 권한으로 해석하지 않는다 — 쓰기는 Guard 확인 후 요청' : '제어 영역 근거 없음',
        review: 'REVIEW' as const,
      };
    }),
  };

  return [master, configured, effective];
}

// ── 승인 순서 (Feature_Topology_Definition v0.8 §2.4) ──
// 순서를 데이터로 고정한다. 화면은 이 순서대로 검사 결과를 묶어 보여준다.
export interface BomApprovalStep {
  no: number;
  ko: string;
  what: string;
  /** approvalChecklist 의 key — 이 단계가 확인하는 검사 */
  checks: string[];
}

export const BOM_APPROVAL_ORDER: BomApprovalStep[] = [
  {
    no: 1,
    ko: '정확 참조 조회',
    what: '정확 FeatureVersion 과 구현 참조를 조회하고 11개 영역의 참조 해결 상태를 확인한다.',
    checks: ['members', 'required', 'items'],
  },
  {
    no: 2,
    ko: 'Item 정합 후 hash 고정',
    what: 'Item 합집합·중복·내용 drift 를 검사한 뒤 contentHash 를 고정한다.',
    checks: ['stray', 'hash'],
  },
  {
    no: 3,
    ko: '검증 결과와 승인 결속',
    what: '고정한 hash 에 연결된 Topology 검증·시험·평가 결과를 확인하고 승인 기록을 결속한다.',
    checks: ['topology', 'assessment', 'approvalHash'],
  },
  {
    no: 4,
    ko: '독립 승인과 재평가',
    what: '내용이 변경되면 이전 평가를 그대로 재사용하지 않고 필요한 범위의 재평가를 수행한다.',
    checks: ['independent', 'conflict', 'blocking'],
  },
];

/** 승인 순서는 BOM 과 Topology 를 서로의 선행 조건으로 만들지 않는다. */
export const BOM_APPROVAL_NON_CIRCULAR =
  'Topology 는 승인 전 BOM 후보에 대해서도 작성·검증할 수 있다. “Topology 승인 후에만 BOM 생성”과 '
  + '“승인 BOM 이 있어야만 Topology 생성”을 동시에 요구하는 순환 절차를 만들지 않는다. '
  + '후보 BOM 의 정확 ref 와 hash 를 기준으로 검증한 뒤 같은 내용을 승인한다.';

// ── 승인 워크플로 (상태 전이·게이트) ──
export type BaselineAction = 'submit' | 'approve' | 'requestChanges' | 'revise' | 'revoke';

export const BASELINE_ACTION_KO: Record<BaselineAction, string> = {
  submit: '검토 요청', approve: '승인', requestChanges: '보완 요청', revise: '다시 작성', revoke: '철회',
};

export interface TransitionResult {
  ok: boolean;
  http: 200 | 202 | 403 | 409 | 412 | 422;
  code?: string;
  message: string;
  next?: BaselineState;
  approval?: ApprovalRef;
}

const ALLOWED_FROM: Record<BaselineAction, BaselineState[]> = {
  submit: ['DRAFT', 'CHANGES_REQUESTED'],
  approve: ['IN_REVIEW'],
  requestChanges: ['IN_REVIEW'],
  revise: ['CHANGES_REQUESTED'],
  revoke: ['APPROVED'],
};

const NEXT_STATE: Record<BaselineAction, BaselineState> = {
  submit: 'IN_REVIEW', approve: 'APPROVED', requestChanges: 'CHANGES_REQUESTED', revise: 'DRAFT', revoke: 'REVOKED',
};

/**
 * 상태 전이와 승인 게이트. 하위 버전 변경·미검증 조합·자기 승인·공유 범위 위반은 승인을 막는다.
 * 명령 접수와 업무 완료를 구분하며, 실패 시 호출자가 입력을 보존한다(여기서 값을 바꾸지 않는다).
 */
export function baselineTransition(
  b: BomBaseline,
  action: BaselineAction,
  actor: string,
  // violations 를 넘기면 저장소의 현재 기준선 집합에서 계산한 결과로 판정한다(초안을 새로 만든 경우 필수).
  opts: { reason?: string; at?: string; role?: string; violations?: BomViolation[] } = {},
): TransitionResult {
  const at = opts.at || '2026-09-13 10:20';
  if (!ALLOWED_FROM[action].includes(b.state)) {
    return {
      ok: false, http: 409, code: 'STATE_CONFLICT',
      message: `${BASELINE_STATE_KO[b.state]} 상태에서는 ${BASELINE_ACTION_KO[action]} 을 할 수 없다 (가능 상태: ${ALLOWED_FROM[action].map(s => BASELINE_STATE_KO[s]).join(', ')})`,
    };
  }

  const blocking = baselineViolationsOf(b, opts.violations ?? BOM_VIOLATIONS).filter(v => v.blocking);
  if (action === 'submit' || action === 'approve') {
    if (b.members.length === 0) {
      return { ok: false, http: 422, code: 'MEMBER_OUTSIDE_BASELINE', message: '구성원이 없는 기준선은 검토로 올릴 수 없다' };
    }
  }
  if (action === 'requestChanges' && !opts.reason?.trim()) {
    return { ok: false, http: 422, code: 'REASON_REQUIRED', message: '보완 사유가 필요하다' };
  }
  if (action === 'approve') {
    // 승인 후보의 내용이 승인 기록과 다르면 새 버전·재검토다
    if (b.approval && b.approval.contentHashRef !== b.contentHash) {
      return { ok: false, http: 409, code: 'HASH_MISMATCH', message: `승인 후보 hash ${b.contentHash.slice(0, 12)}… 가 승인 기록 ${b.approval.contentHashRef.slice(0, 12)}… 와 다름 — 새 버전과 재검토가 필요하다` };
    }
    if (actor === b.author) {
      return { ok: false, http: 403, code: 'SELF_APPROVAL', message: '작성자와 같은 주체는 승인할 수 없다 — 별도 승인자가 필요하다' };
    }
    if (!b.assessmentRef || (b.assessmentRef.hashRef !== 'CURRENT' && b.assessmentRef.hashRef !== b.contentHash)) {
      return { ok: false, http: 412, code: 'ASSESSMENT_REQUIRED', message: '현재 contentHash 의 검증 결과가 없다 — 재검증 후 승인한다' };
    }
    if (b.assessmentRef.result === 'FAIL') {
      return { ok: false, http: 422, code: 'UNRESOLVED_ITEM', message: `검증 결과 FAIL (${b.assessmentRef.id}) — 승인할 수 없다` };
    }
    if (blocking.length) {
      return { ok: false, http: 422, code: blocking[0].code, message: `승인 차단 위반 ${blocking.length}건 — ${blocking.map(v => v.code).join(', ')}` };
    }
    return {
      ok: true, http: 202, next: 'APPROVED', message: `승인 접수 — 기준선 ${b.id}@${b.version} 동결, contentHash ${b.contentHash.slice(0, 12)}…`,
      approval: { actor, role: opts.role || 'approver', at, reason: opts.reason?.trim() || '승인', contentHashRef: b.contentHash },
    };
  }
  if (blocking.length && action === 'submit') {
    return { ok: false, http: 422, code: blocking[0].code, message: `검토 요청 차단 위반 ${blocking.length}건 — ${blocking.map(v => v.code).join(', ')}` };
  }
  return {
    ok: true, http: 202, next: NEXT_STATE[action],
    message: action === 'revoke'
      ? `철회 접수 — 기준선 ${b.id}@${b.version} 기록은 보존하고 후속 발행을 차단한다`
      : `${BASELINE_ACTION_KO[action]} 접수 — Location: /api/ui/v1/commands/cmd-${b.id}-${action}`,
  };
}

/** 화면 KPI — 계산 결과만 노출한다. */
export function bomStats(baselines: BomBaseline[] = BOM_BASELINES, violations: BomViolation[] = BOM_VIOLATIONS) {
  const byState = Object.fromEntries(BASELINE_STATES.map(s => [s, baselines.filter(b => b.state === s).length])) as Record<BaselineState, number>;
  return {
    total: baselines.length,
    byState,
    approved: byState.APPROVED,
    inReview: byState.IN_REVIEW,
    draft: byState.DRAFT,
    revoked: byState.REVOKED,
    members: baselines.reduce((n, b) => n + b.members.length, 0),
    items: baselines.reduce((n, b) => n + b.items.length, 0),
    areas: BOM_AREAS.length,
    blocking: violations.filter(v => v.blocking).length,
    hashVerified: baselines.filter(b => !!b.approval && b.approval.contentHashRef === b.contentHash).length,
    hashMismatch: baselines.filter(b => !!b.approval && b.approval.contentHashRef !== b.contentHash).length,
    independentApproval: baselines.filter(b => !!b.approval && b.approval.actor !== b.author).length,
  };
}

/** FeatureVersion 기준선 사용처 역조회 (UI02-R06 · Registry 승인 여부·조회 시각) */
export function baselineUsageOf(featureVersionRef: string, baselines: BomBaseline[] = BOM_BASELINES) {
  return baselines
    .filter(b => b.members.some(m => m.featureVersionRef === featureVersionRef))
    .map(b => ({
      ref: `${b.id}@${b.version}`,
      state: b.state,
      approved: b.state === 'APPROVED' && !!b.approval && b.approval.contentHashRef === b.contentHash,
      approvedAt: b.approval?.at,
      approver: b.approval?.actor,
      contentHash: b.contentHash,
      independent: !!b.approval && b.approval.actor !== b.author,
    }));
}

/** UI04-S02-A02 — 모든 구성원의 구현 참조를 검사한다. 동일 hash 의 findings 를 반환하며 업무 상태를 바꾸지 않는다. */
export function memberCheckReport(b: BomBaseline, hash = b.contentHash) {
  return {
    hash,
    checkedAt: '2026-09-13 10:18',
    rows: b.members.map(m => {
      const impl = IMPL_BOM_INDEX.get(m.implementationRef);
      const profile = CONDITION_ROWS_BY_REF.get(m.conditionProfileRef);
      const unresolved = (impl?.items || []).filter(i => i.resolution === 'UNRESOLVED').map(i => BOM_AREA_KO[i.area]);
      return {
        memberId: m.memberId,
        featureVersionRef: m.featureVersionRef,
        implementationRef: m.implementationRef,
        conditionProfileRef: m.conditionProfileRef,
        implKnown: !!impl,
        featureMatches: !!impl && impl.featureRef === m.featureVersionRef,
        profileKnown: !!profile,
        unresolvedAreas: unresolved,
        ok: !!impl && impl.featureRef === m.featureVersionRef && !!profile && unresolved.length === 0,
      };
    }),
  };
}
