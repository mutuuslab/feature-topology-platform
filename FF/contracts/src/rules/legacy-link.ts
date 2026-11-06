// Legacy 연계 설정·데이터 브리지·변환 규칙(D05-03, FR-LGCY-001-001~006)과 Legacy↔SDV 메시지 변환(D05-07, FR-SDVI-001-002).
// 연계 설정 한 건 = 기존 운영 시스템 하나(시스템 코드 유일). 등록·수정하면 설정에서 브리지(유형·방향·단계·주기)를 만든다 — 코드에 고정하지 않는다.
// 변환 규칙 = 레거시 옵션 코드 → FEAT ID(기본 규칙은 픽스처, 담당자가 등록·수정한 규칙이 우선). 메시지 변환은 형식 표(LEGACY_MESSAGE_FORMATS)대로만.
import { z } from 'zod';
import type { Role } from '../enums';
import type { LegacyMapping, LegacyVehicle } from './ext';

/** 연계 설정 등록·수정·삭제 — 연계 담당(구현 담당자)·운영 리더 */
export const LEGACY_LINK_EDITORS: Role[] = ['IMPLEMENTER', 'OPS_LEAD'];
/** 브리지 실행(수동) — 운영자·연계 담당·외부 스케줄러(SYSTEM) */
export const LEGACY_BRIDGE_RUNNERS: Role[] = ['OPERATOR', 'IMPLEMENTER', 'SYSTEM'];
/** 변환 규칙 등록·수정 — 연계 담당·차량 사양 담당(옵션 코드 ↔ Feature 대응을 아는 사람) */
export const LEGACY_RULE_EDITORS: Role[] = ['IMPLEMENTER', 'VARIANT_OWNER'];

/** 기존 운영 시스템 종류 — 변환 규칙 묶음(LegacyMapping.system)과 같은 값 */
export const LEGACY_SYSTEM_KINDS = ['PLANT-ERP', 'DEALER-DMS'] as const;
export type LegacySystemKind = (typeof LEGACY_SYSTEM_KINDS)[number];
export const LEGACY_SYSTEM_KIND_LABEL: Record<LegacySystemKind, string> = { 'PLANT-ERP': '해외공장 ERP', 'DEALER-DMS': '딜러 DMS·진단기' };

/** 브리지 유형(명세 비고 "브리지 유형 정의 필요") */
export const BRIDGE_TYPES = ['BATCH', 'REALTIME', 'FILE'] as const;
export type BridgeType = (typeof BRIDGE_TYPES)[number];
export const BRIDGE_TYPE_DEF: Record<BridgeType, { label: string; description: string; schemes: string[]; schedules: readonly LegacySchedule[]; kinds: readonly LegacySystemKind[] }> = {
  BATCH: { label: '배치', description: '정해진 주기로 상대 시스템 API에서 묶음으로 가져온다', schemes: ['https:'], schedules: ['HOURLY', 'DAILY', 'WEEKLY'], kinds: ['PLANT-ERP'] },
  REALTIME: { label: '실시간', description: '상대 시스템이 보낸 메시지를 받는 즉시 변환한다(주기 없음)', schemes: ['https:'], schedules: [], kinds: ['DEALER-DMS'] },
  FILE: { label: '파일', description: '정해진 주기로 파일 교환 위치(SFTP)에서 받은 파일을 변환한다', schemes: ['sftp:'], schedules: ['DAILY', 'WEEKLY'], kinds: ['PLANT-ERP'] },
};
export const LEGACY_SCHEDULES = ['HOURLY', 'DAILY', 'WEEKLY'] as const;
export type LegacySchedule = (typeof LEGACY_SCHEDULES)[number];
export const LEGACY_SCHEDULE_MS: Record<LegacySchedule, number> = { HOURLY: 3_600_000, DAILY: 86_400_000, WEEKLY: 7 * 86_400_000 };
export const LEGACY_PLANTS = ['TMA', 'HMA', 'HMGC'] as const;
export const LEGACY_LINK_STATES = ['ACTIVE', 'INACTIVE'] as const;
export type LegacyLinkState = (typeof LEGACY_LINK_STATES)[number];

const SystemCode = z.string().trim().regex(/^[A-Z][A-Z0-9-]{2,39}$/, '시스템 코드는 영문 대문자·숫자·하이픈 3~40자(예: ERP-TMA)');
const Endpoint = z
  .string()
  .trim()
  .max(300)
  .refine((u) => /^(https|sftp):\/\/[^\s/]+/.test(u), '연결 주소는 https:// 또는 sftp://로 시작해야 합니다');

const LinkFields = {
  name: z.string().trim().min(2).max(80),
  kind: z.enum(LEGACY_SYSTEM_KINDS),
  endpoint: Endpoint,
  bridgeType: z.enum(BRIDGE_TYPES),
  schedule: z.enum(LEGACY_SCHEDULES).nullable(),
  /** 해외공장 ERP만 — 가져올 공장 */
  plant: z.enum(LEGACY_PLANTS).nullable(),
  status: z.enum(LEGACY_LINK_STATES),
  note: z.string().trim().max(300).nullable(),
};
export const CreateLegacyLinkBody = z
  .object({ system: SystemCode, ...LinkFields, schedule: LinkFields.schedule.default(null), plant: LinkFields.plant.default(null), status: LinkFields.status.default('INACTIVE'), note: LinkFields.note.default(null) })
  .strict();
export type CreateLegacyLinkBody = z.infer<typeof CreateLegacyLinkBody>;
export const UpdateLegacyLinkBody = z
  .object({
    name: LinkFields.name.optional(),
    endpoint: LinkFields.endpoint.optional(),
    bridgeType: LinkFields.bridgeType.optional(),
    schedule: LinkFields.schedule.optional(),
    plant: LinkFields.plant.optional(),
    status: LinkFields.status.optional(),
    note: LinkFields.note.optional(),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type UpdateLegacyLinkBody = z.infer<typeof UpdateLegacyLinkBody>;
export const DeleteLegacyLinkBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export const RunLegacyBridgeBody = z.object({}).strict();

export interface LegacyLinkConfig {
  system: string;
  name: string;
  kind: LegacySystemKind;
  endpoint: string;
  bridgeType: BridgeType;
  schedule: LegacySchedule | null;
  plant: (typeof LEGACY_PLANTS)[number] | null;
  status: LegacyLinkState;
  note: string | null;
}

/** 설정 조합 검사 — 종류·브리지 유형·주소 방식·주기·공장. 어긋나면 이유 목록 */
export function legacyLinkProblems(c: LegacyLinkConfig): string[] {
  const d = BRIDGE_TYPE_DEF[c.bridgeType];
  const out: string[] = [];
  if (!d.kinds.includes(c.kind)) out.push(`${LEGACY_SYSTEM_KIND_LABEL[c.kind]}에는 ${d.label} 브리지를 쓸 수 없습니다(가능: ${BRIDGE_TYPES.filter((t) => BRIDGE_TYPE_DEF[t].kinds.includes(c.kind)).map((t) => BRIDGE_TYPE_DEF[t].label).join('·')})`);
  const scheme = /^([a-z]+:)/.exec(c.endpoint)?.[1] ?? '';
  if (!d.schemes.includes(scheme)) out.push(`${d.label} 브리지의 연결 주소는 ${d.schemes.map((s) => `${s}//`).join(' 또는 ')}로 시작해야 합니다`);
  if (d.schedules.length && !c.schedule) out.push(`${d.label} 브리지는 실행 주기가 필요합니다(${d.schedules.join('·')})`);
  if (!d.schedules.length && c.schedule) out.push(`${d.label} 브리지는 주기 없이 메시지를 받을 때 돕니다 — 주기를 비우세요`);
  if (c.schedule && d.schedules.length && !d.schedules.includes(c.schedule)) out.push(`${d.label} 브리지 주기는 ${d.schedules.join('·')} 중 하나입니다`);
  if (c.kind === 'PLANT-ERP' && !c.plant) out.push('해외공장 ERP 연계는 공장(TMA·HMA·HMGC)을 정해야 합니다');
  if (c.kind !== 'PLANT-ERP' && c.plant) out.push('공장은 해외공장 ERP 연계에만 정합니다');
  return out;
}

export interface LegacyBridge {
  bridgeId: string;
  type: BridgeType;
  direction: 'INBOUND' | 'BIDIRECTIONAL';
  /** 쓰는 외부 연계(IF) */
  ifId: string | null;
  /** 변환 규칙 묶음 */
  ruleSystem: LegacySystemKind;
  trigger: string;
  steps: string[];
}

/** 설정 → 브리지 구성(FR-LGCY-001-005). 같은 설정이면 같은 브리지 */
export function legacyBridge(c: LegacyLinkConfig): LegacyBridge {
  const every = c.schedule ? { HOURLY: '매시', DAILY: '매일', WEEKLY: '매주' }[c.schedule] : null;
  if (c.kind === 'PLANT-ERP')
    return {
      bridgeId: `BRG-${c.system}`,
      type: c.bridgeType,
      direction: 'INBOUND',
      ifId: 'IF-12',
      ruleSystem: 'PLANT-ERP',
      trigger: `${every ?? '수동'} ${c.bridgeType === 'FILE' ? '파일 받기' : '가져오기'} — 활성일 때만`,
      steps: [
        c.bridgeType === 'FILE' ? `수집: ${c.plant} 생산 주문 파일(${c.endpoint})` : `수집: ${c.plant} 생산 주문(IF-12, ${c.endpoint})`,
        '변환: 레거시 옵션 코드 → FEAT ID(변환 규칙 PLANT-ERP)',
        '적재: 공장 주문 해석 결과 — 미해석 코드는 남겨 규칙 추가 대상',
      ],
    };
  return {
    bridgeId: `BRG-${c.system}`,
    type: c.bridgeType,
    direction: 'BIDIRECTIONAL',
    ifId: null,
    ruleSystem: 'DEALER-DMS',
    trigger: '메시지를 받을 때 즉시 — 활성일 때만',
    steps: ['받기: 딜러 진단기 코딩 읽기 메시지(LGC-CODING-1)', '변환: 코딩 DID → FEAT ID·켜짐/꺼짐(SDV-FEATURE-STATE-1)', '내보내기: Feature 켜기·끄기 → 딜러 코딩 계획(LGC-CODING-1)'],
  };
}

export const LegacyLinkView = z.object({
  linkId: z.string(),
  system: z.string(),
  name: z.string(),
  kind: z.enum(LEGACY_SYSTEM_KINDS),
  endpoint: z.string(),
  bridgeType: z.enum(BRIDGE_TYPES),
  schedule: z.enum(LEGACY_SCHEDULES).nullable(),
  plant: z.enum(LEGACY_PLANTS).nullable(),
  status: z.enum(LEGACY_LINK_STATES),
  note: z.string().nullable(),
  version: z.number().int(),
  bridge: z.object({ bridgeId: z.string(), type: z.enum(BRIDGE_TYPES), direction: z.enum(['INBOUND', 'BIDIRECTIONAL']), ifId: z.string().nullable(), ruleSystem: z.enum(LEGACY_SYSTEM_KINDS), trigger: z.string(), steps: z.array(z.string()) }),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  lastRun: z.object({ at: z.string(), status: z.enum(['SUCCEEDED', 'FAILED']), orders: z.number().int(), unresolved: z.array(z.string()), reason: z.string().nullable(), by: z.string() }).nullable(),
});
export type LegacyLinkView = z.infer<typeof LegacyLinkView>;

/** 다음 주기 실행 시각이 됐나 — 활성 배치·파일 브리지만. 한 번도 안 돌았으면 바로 */
export function legacyRunDue(l: Pick<LegacyLinkView, 'status' | 'bridgeType' | 'schedule' | 'lastRun'>, now: string): boolean {
  if (l.status !== 'ACTIVE' || !l.schedule || l.bridgeType === 'REALTIME') return false;
  if (!l.lastRun) return true;
  return Date.parse(now) - Date.parse(l.lastRun.at) >= LEGACY_SCHEDULE_MS[l.schedule];
}

// ───────── 변환 규칙(FR-LGCY-001-006) ─────────

/** 규칙 항목(명세 비고 "변환 규칙 항목 정의 필요") — 레거시 코드·규칙 묶음(시스템 종류)·설명·대상 FEAT·메모 */
export const LegacyCode = z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, '레거시 코드는 영문 대문자·숫자·하이픈 2~32자');
export const CreateLegacyRuleBody = z
  .object({
    legacyCode: LegacyCode,
    system: z.enum(LEGACY_SYSTEM_KINDS),
    description: z.string().trim().min(2).max(120),
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    note: z.string().trim().max(300).nullable().default(null),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type CreateLegacyRuleBody = z.infer<typeof CreateLegacyRuleBody>;
export const UpdateLegacyRuleBody = z
  .object({
    description: z.string().trim().min(2).max(120).optional(),
    featureId: z.string().regex(/^FEAT-\d{5}$/).optional(),
    note: z.string().trim().max(300).nullable().optional(),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type UpdateLegacyRuleBody = z.infer<typeof UpdateLegacyRuleBody>;

export interface LegacyRule extends LegacyMapping {
  /** FIXTURE = 기본 규칙(모의 외부 시스템 표), REGISTERED = 담당자가 등록·수정 */
  source: 'FIXTURE' | 'REGISTERED';
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
/** 기본 규칙 + 등록 규칙(같은 코드면 등록이 이긴다) — 코드 순 */
export function mergeLegacyRules(base: LegacyMapping[], registered: LegacyRule[]): LegacyRule[] {
  const out = new Map<string, LegacyRule>(base.map((m) => [m.legacyCode, { ...m, source: 'FIXTURE', version: 0, updatedBy: null, updatedAt: null }]));
  for (const r of registered) out.set(r.legacyCode, r);
  return [...out.values()];
}

// ───────── Legacy ↔ SDV 메시지 형식(FR-SDVI-001-002) ─────────

/** 메시지 형식 표(명세 비고 "변환 대상 메시지 포맷 정의 필요") */
export const LEGACY_MESSAGE_FORMATS = {
  'LGC-CODING-1': {
    side: 'LEGACY' as const,
    label: '레거시 딜러 코딩 메시지',
    fields: [
      { name: 'format', rule: '"LGC-CODING-1"' },
      { name: 'system', rule: '보낸 연계 설정의 시스템 코드(활성 실시간 브리지)' },
      { name: 'vin', rule: '레거시 차량 VIN' },
      { name: 'unit', rule: '코딩 제어기(차량의 codingUnit, 예: BCM)' },
      { name: 'records[].did', rule: 'F1 + FEAT 끝 세 자리(예: F1024)' },
      { name: 'records[].value', rule: '01 = 켜짐, 00 = 꺼짐' },
      { name: 'readAt', rule: '진단기가 읽은 시각(ISO 8601)' },
    ],
  },
  'SDV-FEATURE-STATE-1': {
    side: 'SDV' as const,
    label: 'SDV Feature 상태 메시지',
    fields: [
      { name: 'format', rule: '"SDV-FEATURE-STATE-1"' },
      { name: 'vin', rule: '차량 VIN' },
      { name: 'observedAt', rule: '상태를 읽은 시각' },
      { name: 'features[].featureId', rule: 'FEAT-NNNNN' },
      { name: 'features[].state', rule: 'ENABLED · DISABLED' },
      { name: 'features[].source', rule: '원래 레거시 위치(unit·did)' },
    ],
  },
};
export type LegacyMessageFormat = keyof typeof LEGACY_MESSAGE_FORMATS;

/** 받는 레거시 메시지 — 형식 이름이 틀려도 받아서 변환 실패로 기록한다(본문 모양만 거른다) */
export const LegacyMessageBody = z
  .object({
    format: z.string().trim().min(1).max(40),
    system: z.string().trim().min(1).max(40),
    vin: z.string().trim().min(3).max(40),
    unit: z.string().trim().min(1).max(20),
    records: z.array(z.object({ did: z.string().trim().min(1).max(10), value: z.string().trim().min(1).max(10) }).strict()).min(1).max(50),
    readAt: z.string().trim().min(10).max(40),
  })
  .strict();
export type LegacyMessageBody = z.infer<typeof LegacyMessageBody>;

export interface LegacyCodingMessage {
  format: 'LGC-CODING-1';
  vin: string;
  unit: string;
  records: { did: string; value: string }[];
}
export interface SdvFeatureStateMessage {
  format: 'SDV-FEATURE-STATE-1';
  vin: string;
  observedAt: string;
  features: { featureId: string; state: 'ENABLED' | 'DISABLED'; source: { unit: string; did: string } }[];
}

/** SDV Feature 켜기·끄기 → 레거시 코딩 메시지(legacyPlan의 명령을 형식에 싣는다) */
export function toLegacyCodingMessage(vin: string, commands: { unit: string; did: string; value: string }[]): LegacyCodingMessage {
  return { format: 'LGC-CODING-1', vin, unit: commands[0]?.unit ?? '', records: commands.map((c) => ({ did: c.did, value: c.value })) };
}

export type LegacyToSdvResult = { ok: true; message: SdvFeatureStateMessage } | { ok: false; reason: string };

/**
 * 레거시 코딩 메시지 → SDV Feature 상태. 실패 이유(첫 번째)를 돌려준다 — 형식·차량·제어기·DID·값·Feature 대응.
 * DID는 FEAT 끝 세 자리라 같은 끝자리 Feature가 둘 이상이면 모호하다(변환 실패).
 */
export function legacyToSdv(msg: LegacyMessageBody, vehicle: LegacyVehicle | undefined, featureIds: string[]): LegacyToSdvResult {
  if (msg.format !== 'LGC-CODING-1') return { ok: false, reason: `모르는 메시지 형식입니다: ${msg.format} (받는 형식: LGC-CODING-1)` };
  if (!vehicle) return { ok: false, reason: `${msg.vin}은(는) 레거시 차량 목록에 없습니다` };
  if (msg.unit !== vehicle.codingUnit) return { ok: false, reason: `${msg.vin}의 코딩 제어기는 ${vehicle.codingUnit}입니다(메시지: ${msg.unit})` };
  if (Number.isNaN(Date.parse(msg.readAt))) return { ok: false, reason: `읽은 시각 ${msg.readAt}이(가) 올바른 시각이 아닙니다` };
  const features: SdvFeatureStateMessage['features'] = [];
  for (const r of msg.records) {
    const m = /^F1(\d{3})$/.exec(r.did);
    if (!m) return { ok: false, reason: `DID ${r.did}은(는) Feature 코딩 위치(F1NNN)가 아닙니다` };
    const hits = featureIds.filter((f) => f.endsWith(m[1]));
    if (!hits.length) return { ok: false, reason: `DID ${r.did}에 대응하는 Feature가 없습니다` };
    if (hits.length > 1) return { ok: false, reason: `DID ${r.did}이(가) 여러 Feature(${hits.join(', ')})에 대응해 하나로 정할 수 없습니다` };
    if (r.value !== '01' && r.value !== '00') return { ok: false, reason: `DID ${r.did}의 값 ${r.value}은(는) 켜짐(01)·꺼짐(00)이 아닙니다` };
    features.push({ featureId: hits[0], state: r.value === '01' ? 'ENABLED' : 'DISABLED', source: { unit: msg.unit, did: r.did } });
  }
  return { ok: true, message: { format: 'SDV-FEATURE-STATE-1', vin: msg.vin, observedAt: new Date(Date.parse(msg.readAt)).toISOString(), features } };
}

export const LegacyMessageLogView = z.object({
  messageId: z.string(),
  at: z.string(),
  direction: z.enum(['LEGACY_TO_SDV', 'SDV_TO_LEGACY']),
  system: z.string().nullable(),
  vin: z.string(),
  formatIn: z.string(),
  formatOut: z.string().nullable(),
  status: z.enum(['CONVERTED', 'FAILED']),
  reason: z.string().nullable(),
  actorId: z.string(),
  output: z.unknown().nullable(),
});
export type LegacyMessageLogView = z.infer<typeof LegacyMessageLogView>;
