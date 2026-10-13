// OpenFeature 평가 문맥 (OF-4) — 앱·차량 SDK가 보내는 EvaluationContext와 FF 차량 등록 정보의 대응.
// targetingKey = VIN(vehicleKey). 국가·차종·트림·SW 같은 속성은 등록 정보가 신뢰 원천이다 — SDK가 보낸 값은 판단에 쓰지 않고,
// 등록 정보와 다르면 응답 metadata(ignoredContext)로 알린다(차량 발신 요청의 TRUST_SOURCE 규칙과 같다).
import type { Vehicle } from '../schemas/policy';

/** OpenFeature 문맥 속성 → 차량 등록 필드 */
export const OPENFEATURE_CONTEXT: Record<string, keyof Vehicle> = {
  country: 'country',
  vehicleModel: 'vehicleModel',
  vehicleTrim: 'trim',
  modelYear: 'modelYear',
  upgVc: 'upgVc',
  swVersion: 'swVersion',
};

/** SDK가 보낸 속성 중 등록 정보와 다른 것 (판단에는 등록 정보를 쓴다) */
export function ignoredContext(ctx: Record<string, unknown> | undefined, v: Vehicle): string[] {
  if (!ctx) return [];
  return Object.entries(OPENFEATURE_CONTEXT)
    .filter(([attr, field]) => ctx[attr] !== undefined && String(ctx[attr]) !== String(v[field]))
    .map(([attr]) => attr);
}

// ───────────────────────── OpenFeature 경계 (보고서 v1.1 11장 · FFG-OFT · FFG-PLT-011) ─────────────────────────
// OpenFeature는 IVI 앱 같은 QM 소비자를 위한 평가 API다. 차량 제어 SW·Safety Guard는 OpenFeature를 쓰지 않는다 —
// F2 이상 Feature의 flag 값은 서명 정책·차량 Safety Guard 경로(/vehicle/v1, 정책 게시본)로만 전달된다.
import type { FClass } from '../schemas/safety';
import type { Policy } from '../schemas/policy';
import type { OtelSpan } from '../rules/ext';

const F_RANK: Record<FClass, number> = { F0: 0, F1: 1, F2: 2, F3: 3, F4: 4 };

/** 사용하는 OpenFeature 사양·SDK Version — 정확히 고정(범위 지정 금지), SBOM에 기록 (@rule FFG-OFT-007) */
export const OPENFEATURE_PINS = {
  spec: '0.8.0',
  sdks: { '@openfeature/server-sdk': '1.23.0', '@openfeature/ofrep-provider': '0.2.5', '@openfeature/web-sdk': '1.10.0', '@openfeature/ofrep-web-provider': '0.4.3' },
  /** 양산 판단에 쓰지 않는 Experimental 기능 */
  experimental: ['Tracking', 'Multi-Provider', 'transaction context propagation'],
} as const;

/**
 * OpenFeature로 평가해도 되는가 — F0·F1만. F2 이상은 값을 계산하지 않고 호출자 기본값(= Safe State)과 reason DISABLED.
 * @rule FFG-OFT-001 — OpenFeature는 F0·F1 평가에만, F2 이상은 기본값과 DISABLED
 * @rule FFG-PLT-011 — OpenFeature는 QM 평가 API로만 사용
 */
export function openFeatureAllowed(fClass: FClass): boolean {
  return F_RANK[fClass] <= 1;
}
export const SAFETY_GUARD_METADATA = { decided_by: 'vehicle_safety_guard' } as const;

/**
 * Evaluation Context 금지 속성 — 위치·운전자 식별·연락처·차량 동적 상태. 하나라도 있으면 INVALID_CONTEXT로 거부(before 단계).
 * @rule FFG-OFT-003 — Evaluation Context에 개인정보·위치·주행 상태를 넣지 않는다
 */
export const FORBIDDEN_CONTEXT: { key: RegExp; kind: '위치' | '운전자 식별' | '연락처' | '차량 동적 상태' }[] = [
  { key: /^(lat|lon|lng|latitude|longitude|gps|location|position|geo.*|address)$/i, kind: '위치' },
  { key: /^(driver.*|user(name|id)?|account.*|name|birth.*|license.*|face.*)$/i, kind: '운전자 식별' },
  { key: /^(email|phone|mobile|contact.*)$/i, kind: '연락처' },
  { key: /^(speed|velocity|accel.*|gear|steering.*|brake.*|throttle|yaw.*|heading)$/i, kind: '차량 동적 상태' },
];
export function contextViolations(ctx: Record<string, unknown> | undefined): { key: string; kind: string }[] {
  if (!ctx) return [];
  return Object.keys(ctx)
    .filter((k) => k !== 'targetingKey')
    .flatMap((k) => {
      const hit = FORBIDDEN_CONTEXT.find((f) => f.key.test(k));
      return hit ? [{ key: k, kind: hit.kind }] : [];
    });
}

/**
 * 평가 감사 기록(finally Hook) — 성공·오류 모두, OTel feature_flag 의미 규약 속성으로. 원본 targeting key·개인정보는 넣지 않고 가명 subject만.
 * @rule FFG-OFT-004 — 감사 Hook과 가명 기록
 */
export function evaluationSpan(e: {
  flagKey: string;
  provider: string;
  subject: string;
  fClass: FClass | null;
  variant: string | null;
  reason: string;
  errorType: string | null;
  snapshotVersion: string | null;
  at: string;
  traceSeed: string;
}): OtelSpan {
  const hex = (n: number) => Array.from({ length: n }, (_, i) => ((e.traceSeed.charCodeAt(i % e.traceSeed.length) * 31 + i * 7) % 16).toString(16)).join('');
  const attributes: Record<string, string | number | boolean> = {
    'feature_flag.key': e.flagKey,
    'feature_flag.provider.name': e.provider,
    'feature_flag.result.reason': e.reason.toLowerCase(),
    'feature_flag.context.id': e.subject,
    'ffp.f_class': e.fClass ?? 'unknown',
  };
  if (e.variant) attributes['feature_flag.result.variant'] = e.variant;
  if (e.errorType) attributes['error.type'] = e.errorType;
  if (e.snapshotVersion) attributes['feature_flag.version'] = e.snapshotVersion;
  return { traceId: hex(32), spanId: hex(16), name: 'feature_flag.evaluation', startTime: e.at, attributes };
}

export interface FlagCatalogItem {
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: FClass;
  safeDefault: boolean;
  description: string;
  revisions: number[];
  /** 같은 flag의 revision마다 Safe Default가 다르면 규율 위반 */
  defaultsConsistent: boolean;
}

/** 정책 → flag 목록(배포·승인 정책, flag별 최신 revision) */
export function flagCatalog(policies: Policy[], fClassOf: (featureId: string, version: string) => FClass): FlagCatalogItem[] {
  const by = new Map<string, Policy[]>();
  for (const p of policies.filter((x) => x.status === 'DEPLOYED' || x.status === 'APPROVED')) by.set(p.flagKey, [...(by.get(p.flagKey) ?? []), p]);
  return [...by.entries()]
    .map(([flagKey, ps]) => {
      const last = [...ps].sort((a, b) => b.revision - a.revision)[0];
      return {
        flagKey,
        featureId: last.featureId,
        featureVersion: last.featureVersion,
        fClass: fClassOf(last.featureId, last.featureVersion),
        safeDefault: last.safeDefault,
        description: last.description,
        revisions: ps.map((p) => p.revision).sort((a, b) => a - b),
        defaultsConsistent: new Set(ps.map((p) => p.safeDefault)).size === 1,
      };
    })
    .sort((a, b) => a.flagKey.localeCompare(b.flagKey));
}

/**
 * flagd 내보내기 — F0·F1 flag만, 기본 variant는 off(Safe State). 내보낸 결과를 다시 검사한다.
 * @rule FFG-OFT-005 — F2 이상 Flag는 OpenFeature 백엔드로 내보내지 않는다
 * @rule FFG-OFT-002 — 기본값은 Safe State (flagd defaultVariant=off)
 */
export function flagdExport(items: FlagCatalogItem[]) {
  const allowed = items.filter((i) => openFeatureAllowed(i.fClass));
  const flags = Object.fromEntries(
    allowed.map((i) => [i.flagKey, { state: 'ENABLED', variants: { on: true, off: false }, defaultVariant: i.safeDefault ? 'on' : 'off', metadata: { featureId: i.featureId, featureVersion: i.featureVersion, f_class: i.fClass } }]),
  );
  const excluded = items.filter((i) => !openFeatureAllowed(i.fClass)).map((i) => ({ flagKey: i.flagKey, fClass: i.fClass }));
  const leaked = Object.keys(flags).filter((k) => !openFeatureAllowed(items.find((i) => i.flagKey === k)!.fClass));
  return { $schema: 'https://flagd.dev/schema/v0/flags.json', flags, excluded, check: { leakedF2Keys: leaked, ok: leaked.length === 0 } };
}

/**
 * OF-7 flag 매니페스트(OpenFeature CLI 형식) + 기본값 규율 — 코드 기본값은 매니페스트의 Safe Default와 같아야 하고,
 * flag 유형은 boolean(FP-VEHICLE-BOOL-1), revision마다 기본값이 바뀌면 안 된다. F2 이상은 매니페스트에 넣지 않는다(OFT-005).
 */
export function flagManifest(items: FlagCatalogItem[]) {
  const findings: { flagKey: string; rule: string; message: string }[] = [];
  for (const i of items) {
    if (!i.defaultsConsistent) findings.push({ flagKey: i.flagKey, rule: 'OF7-DEFAULT-DRIFT', message: `${i.flagKey}: revision ${i.revisions.join('·')}의 Safe Default가 서로 다릅니다` });
    if (i.safeDefault !== false) findings.push({ flagKey: i.flagKey, rule: 'FFG-OFT-002', message: `${i.flagKey}: Safe State가 아닌 기본값(true) — 기능 꺼짐(false)이어야 합니다` });
  }
  const flags = Object.fromEntries(items.filter((i) => openFeatureAllowed(i.fClass)).map((i) => [i.flagKey, { flagType: 'boolean', defaultValue: i.safeDefault, description: i.description }]));
  return { $schema: 'https://raw.githubusercontent.com/open-feature/cli/main/schema/v0/flag-manifest.json', flags, findings };
}

/** OpenFeature 반영 범위 — 범위 화면(/integration/openfeature)과 시험이 같이 읽는다. 상태는 구현·근거가 실재할 때만 'done' */
export interface OpenFeatureScopeItem {
  id: string;
  title: string;
  /** 무엇을 하는가 — 한 줄 */
  what: string;
  side: 'server' | 'web' | 'vehicle' | 'governance';
  status: 'done' | 'excluded';
  rules: string[];
  endpoints: string[];
  tests: string[];
}
export const OPENFEATURE_SCOPE: OpenFeatureScopeItem[] = [
  { id: 'OF-1', title: '서버 SDK 적합성', what: '공식 @openfeature/server-sdk + OFREP provider로 평가 — 값·variant·reason·flagMetadata, 오류는 기본값', side: 'server', status: 'done', rules: [], endpoints: ['POST /ofrep/v1/evaluate/flags/:key'], tests: ['backend/test/d05/openfeature.spec.ts'] },
  { id: 'OF-2', title: '웹 SDK 패널', what: '공식 @openfeature/web-sdk + OFREP 웹 provider — 활성화 판단 화면에서 SDK 값과 서버 판단 대조', side: 'web', status: 'done', rules: [], endpoints: ['POST /ofrep/v1/evaluate/flags'], tests: ['frontend/src/__tests__/screensP9.test.tsx'] },
  { id: 'OF-3', title: '변경 감지', what: 'bulk ETag 폴링으로 차단·배포 변경을 감지 → PROVIDER_CONFIGURATION_CHANGED', side: 'web', status: 'done', rules: ['FFG-OFT-006'], endpoints: ['POST /ofrep/v1/evaluate/flags (ETag/304)'], tests: ['e2e/tests/poc.spec.ts'] },
  { id: 'OF-4', title: '평가 문맥 표준화', what: 'targetingKey = 차량 가명(또는 등록 VIN), 국가·차종 등은 등록 정보가 원천 — 다른 값은 ignoredContext로 알림', side: 'server', status: 'done', rules: ['FFG-OFT-003'], endpoints: ['POST /ofrep/v1/evaluate/flags/:key'], tests: ['backend/test/d05/openfeature.spec.ts'] },
  { id: 'OF-5', title: '감사 Hook · OTel', what: '모든 평가(성공·오류)를 가명 subject·f_class와 함께 OTel feature_flag span으로 IF-11 수집기에', side: 'server', status: 'done', rules: ['FFG-OFT-004'], endpoints: ['GET /api/integrations/otel/spans'], tests: ['backend/test/d05/openfeature.spec.ts'] },
  { id: 'OF-6', title: '차량 내장 provider', what: 'IVI 앱용 — 차량이 받은 서명 정책 묶음으로 로컬 평가(오프라인 STALE), F2 이상은 기본값·DISABLED', side: 'vehicle', status: 'done', rules: ['FFG-OFT-001', 'FFG-OFT-006'], endpoints: ['GET /api/vehicles/:vin/openfeature'], tests: ['backend/test/d05/openfeature.spec.ts'] },
  { id: 'OF-7', title: 'flag 매니페스트·기본값 규율', what: 'OpenFeature CLI 매니페스트(F0·F1만), 코드 기본값 = Safe State, SDK Version 정확 고정', side: 'governance', status: 'done', rules: ['FFG-OFT-002', 'FFG-OFT-005', 'FFG-OFT-007'], endpoints: ['GET /api/openfeature/manifest', 'GET /api/openfeature/flagd'], tests: ['contracts/src/flags/openfeature.test.ts', 'tools/openfeature-check.ts'] },
  { id: 'BOUNDARY', title: 'OpenFeature 경계 (F0·F1만)', what: 'F2 이상 flag는 OpenFeature로 값을 계산하지 않음 — 서명 정책·차량 Safety Guard 경로(/vehicle/v1)로만', side: 'server', status: 'done', rules: ['FFG-OFT-001', 'FFG-PLT-011'], endpoints: ['POST /ofrep/v1/evaluate/flags/:key'], tests: ['backend/test/d05/openfeature.spec.ts'] },
  { id: 'OUT-1', title: '차량 제어 SW·Safety Guard', what: '쓰지 않음 — 차량 제어 판단은 서명 게시본과 Guard가 한다 (FFG-OFT-001)', side: 'vehicle', status: 'excluded', rules: ['FFG-OFT-001'], endpoints: [], tests: [] },
  { id: 'OUT-2', title: 'Experimental 기능', what: '쓰지 않음 — Tracking·Multi-Provider·트랜잭션 문맥 전파는 양산 판단에 쓰지 않는다 (FFG-OFT-007)', side: 'governance', status: 'excluded', rules: ['FFG-OFT-007'], endpoints: [], tests: [] },
];
