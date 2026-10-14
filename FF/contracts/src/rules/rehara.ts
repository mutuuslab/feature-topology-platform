// 재-HARA 조건 자동 검출 (보고서 v1.1 6.4 · FFG-LCY-003) — 아래 변경은 기존 HARA의 경계를 벗어난 것으로 보고 Safety Manager에게
// 재-HARA를 요청한다. 요청이 열려 있는 동안 그 Version의 G3 이후 Gate PASS는 막히고, G2를 다시 PASS로 판정하면 닫힌다.
//   ① 범위 확대(시장·차종·Variant·ODD)  ② 제어 권한(Control Point·등급·인계·램프 시간·Safe State)  ③ Topology 관계 신규
//   ④ 현장 트리거·오용(ISO 21448 — FEATURE_FAULT·FIELD_SOTIF 이상 징후)  ⑤ TARA 안전 영향 위협(SECURITY 이상 징후)
//   ⑥ ADS 기능의 안전 검증 도구·임계값 변경(가상검증 도구 Version·기준 한계)
import type { FeatureVersionRow, DependencyRow } from '../schemas/dataset';
import type { SafetyProfile } from '../schemas/safety-profile';

export const REHARA_CONDITIONS = ['SCOPE', 'CONTROL', 'TOPOLOGY', 'FIELD', 'TARA', 'ADS_TOOL'] as const;
export type ReharaCondition = (typeof REHARA_CONDITIONS)[number];
export const REHARA_LABEL: Record<ReharaCondition, string> = {
  SCOPE: '운행 조건(ODD)·차종·시장·Variant 확대',
  CONTROL: '제어 권한(개입·경고 시점·강도) 변경',
  TOPOLOGY: '다른 Feature와의 의존·충돌 관계 신규',
  FIELD: '현장 데이터의 새 트리거·오용 사례(ISO 21448)',
  TARA: 'TARA의 안전 영향 새 위협',
  ADS_TOOL: 'ADS 안전 검증 도구·임계값 변경',
};
/** 재-HARA가 열려 있으면 PASS를 막는 Gate — G2(위험 분석) 다음부터 */
export const REHARA_BLOCKED_GATES = ['G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'] as const;

type Prof = Pick<SafetyProfile, 'fClass' | 'deactClass' | 'takeoverMs' | 'rampMs' | 'faultRampMs' | 'safeState' | 'markets' | 'adsFeature'>;
type Feat = Pick<FeatureVersionRow, 'country' | 'vehicleModel' | 'trim' | 'controlPoints'>;

export type ReharaChange =
  | { kind: 'VERSION'; before: { feature: Feat; profile: Prof | null }; after: { feature: Feat; profile: Prof | null } }
  | { kind: 'DEPENDENCY'; dependency: Pick<DependencyRow, 'dependencyId' | 'type' | 'sourceFeatureId' | 'targetFeatureId'> }
  | { kind: 'ANOMALY'; anomalyId: string; anomalyKind: string }
  | { kind: 'TOOL'; adsFeature: boolean; from: { tool: string | null; limits: Record<string, number> }; to: { tool: string | null; limits: Record<string, number> } };

export interface ReharaFinding {
  condition: ReharaCondition;
  detail: string;
  /** 같은 원인으로 요청을 두 번 만들지 않기 위한 참조 */
  ref: string;
}

const diff = <T extends object>(a: T, b: T, keys: (keyof T)[]) => keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

/**
 * 변경 → 해당하는 재-HARA 조건(없으면 빈 목록). 순수 함수 — 서버 수신(이벤트)과 화면 미리보기가 같은 판정을 낸다.
 * @rule FFG-LCY-003 — 6.4절 6조건 자동 검출, 요청은 Safety Manager 몫(재-HARA 수행·G2 재판정은 조직)
 */
export function reharaFindings(c: ReharaChange): ReharaFinding[] {
  const out: ReharaFinding[] = [];
  if (c.kind === 'VERSION') {
    const { before: b, after: a } = c;
    const scope = diff(b.feature, a.feature, ['country', 'vehicleModel', 'trim']);
    const added = (a.profile?.markets ?? []).filter((m) => !(b.profile?.markets ?? []).includes(m));
    if (scope.length || added.length)
      out.push({ condition: 'SCOPE', detail: [...scope.map((k) => `${String(k)} ${b.feature[k]} → ${a.feature[k]}`), ...(added.length ? [`시장 추가 ${added.join(', ')}`] : [])].join(' · '), ref: `scope:${scope.join(',')}:${added.join(',')}` });
    const cp = JSON.stringify([...b.feature.controlPoints].sort()) !== JSON.stringify([...a.feature.controlPoints].sort());
    const prof = b.profile && a.profile ? diff(b.profile, a.profile, ['fClass', 'deactClass', 'takeoverMs', 'rampMs', 'faultRampMs', 'safeState']) : [];
    if (cp || prof.length)
      out.push({
        condition: 'CONTROL',
        detail: [...(cp ? [`Control Point ${b.feature.controlPoints.join(',')} → ${a.feature.controlPoints.join(',')}`] : []), ...prof.map((k) => `${String(k)} ${b.profile![k]} → ${a.profile![k]}`)].join(' · '),
        ref: `control:${cp ? 'cp' : ''}:${prof.join(',')}`,
      });
  } else if (c.kind === 'DEPENDENCY') {
    const d = c.dependency;
    out.push({ condition: 'TOPOLOGY', detail: `${d.dependencyId} ${d.sourceFeatureId} ${d.type} ${d.targetFeatureId}`, ref: `dep:${d.dependencyId}` });
  } else if (c.kind === 'ANOMALY') {
    if (c.anomalyKind === 'FEATURE_FAULT' || c.anomalyKind === 'FIELD_SOTIF') out.push({ condition: 'FIELD', detail: `${c.anomalyId} ${c.anomalyKind}`, ref: `anomaly:${c.anomalyId}` });
    if (c.anomalyKind === 'SECURITY') out.push({ condition: 'TARA', detail: `${c.anomalyId} 보안 이상 징후 — TARA 안전 영향 검토`, ref: `anomaly:${c.anomalyId}` });
  } else if (c.kind === 'TOOL' && c.adsFeature) {
    const limits = Object.keys({ ...c.from.limits, ...c.to.limits }).filter((k) => c.from.limits[k] !== c.to.limits[k]);
    if ((c.from.tool && c.to.tool && c.from.tool !== c.to.tool) || limits.length)
      out.push({ condition: 'ADS_TOOL', detail: [...(c.from.tool !== c.to.tool ? [`도구 ${c.from.tool} → ${c.to.tool}`] : []), ...limits.map((k) => `${k} 한계 ${c.from.limits[k] ?? '—'} → ${c.to.limits[k] ?? '—'}`)].join(' · '), ref: `tool:${c.to.tool}:${limits.map((k) => `${k}=${c.to.limits[k]}`).join(',')}` });
  }
  return out;
}
