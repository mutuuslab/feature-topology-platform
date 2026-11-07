// 추적 연결 출처 모의(P3) — IF-02 기준정보(PLM: SW·ECU 마스터, 인터페이스 정의 도구 카탈로그, SW 패키지 저장소)·IF-09 TMS(Test Case)·IF-01 ALM(Feature 요구 목록).
// 실제 시스템 대신 데이터셋(Feature·SW·ECU 마스터)에서 결정적으로 만든다 — 시드 없는 설치(빈 데이터셋)에는 출처에도 아무것도 없다.
// 연결 방식은 IF_MODE_<번호>(예: IF_MODE_09=off)로 끌 수 있다 — 꺼진 연계로 확인하면 GUARD_FAILED(연계 불가).
// 요구 식별자의 출처 존재 확인(FR-DEP-005-002)은 ALM 연계 묶음(80-50) 몫이라 여기서는 Feature의 전체 요구 목록(커버리지 분모)만 낸다.
import { Injectable } from '@nestjs/common';
import { compareVersion, type FeatureVersionRow, type TraceKind } from '@ff/contracts';
import { DomainError } from '../../kernel/errors';
import { IfCallRepo } from '../if-call/if-call.repo';
import { FeatureRepo, TopologyRepo } from '../../domains/d01-policy/repos';

export interface SourceElement {
  kind: TraceKind;
  elementId: string;
  elementType: string;
  name: string;
  version: string;
  sourceSystem: string;
}

const featureNo = (featureId: string) => featureId.slice(5);
/** Feature별 TMS Test Case — 기능·회귀·가상 주행·HIL·실차 시험 */
const TC_KINDS: [string, string, string][] = [
  ['01', 'FUNCTIONAL', '기능 시험'],
  ['02', 'REGRESSION', '회귀 시험'],
  ['03', 'VIRTUAL', '가상 주행 시험'],
  ['04', 'HIL', 'HIL 시험'],
  ['05', 'VEHICLE', '실차 시험'],
];
const IF_OF: Record<TraceKind, string> = { REQUIREMENT: 'IF-01', ARCHITECTURE: 'IF-02', INTERFACE: 'IF-02', TEST_CASE: 'IF-09', OTA: 'IF-02' };

@Injectable()
export class TraceSources {
  constructor(
    private readonly calls: IfCallRepo,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
  ) {}

  ifOf(kind: TraceKind) {
    return IF_OF[kind];
  }

  private need(kind: TraceKind) {
    const ifId = IF_OF[kind];
    if (process.env[`IF_MODE_${ifId.slice(3)}`] === 'off') throw new DomainError('GUARD_FAILED', `${ifId} 연계가 꺼져 있어 출처를 확인할 수 없습니다 (IF_MODE_${ifId.slice(3)}=off).`, { ifId });
  }

  /** 출처 카탈로그 — 종류별 요소 전체(요구는 조회하지 않는다) */
  catalog(kind: TraceKind): SourceElement[] {
    if (kind === 'REQUIREMENT') return [];
    if (kind === 'TEST_CASE') {
      const latest = new Map<string, FeatureVersionRow>();
      for (const f of this.features.all()) if (!latest.has(f.featureId) || compareVersion(latest.get(f.featureId)!.version, f.version) < 0) latest.set(f.featureId, f);
      return [...latest.values()]
        .sort((a, b) => (a.featureId < b.featureId ? -1 : 1))
        .flatMap((f) => TC_KINDS.map(([n, type, label]) => ({ kind, elementId: `TC-${featureNo(f.featureId)}-${n}`, elementType: type, name: `${f.name} ${label}`, version: '1', sourceSystem: 'TMS' })));
    }
    const sw = this.topology.allSw();
    if (kind === 'OTA') return sw.map((s) => ({ kind, elementId: s.package, elementType: 'SW_PACKAGE', name: s.name, version: s.version, sourceSystem: 'SW_REPO' }));
    const ecu = this.topology.allEcu();
    if (kind === 'ARCHITECTURE')
      return [
        ...sw.map((s) => ({ kind, elementId: s.swId, elementType: 'SW', name: s.name, version: s.version, sourceSystem: 'PLM' })),
        ...ecu.map((e) => ({ kind, elementId: e.ecuPno, elementType: 'HW', name: e.name, version: e.hwRevision, sourceSystem: 'PLM' })),
      ];
    // 인터페이스 정의 도구 — SW 실행 단위마다 서비스 API·상태 Signal·고장 Event, ECU마다 통신 이상 DTC
    const unit = (s: { executionUnit: string }) => s.executionUnit.toUpperCase();
    return [
      ...sw.flatMap((s) => [
        { kind, elementId: `API.${s.executionUnit}`, elementType: 'API', name: `${s.name} 서비스 API`, version: s.version, sourceSystem: 'IDT' },
        { kind, elementId: `SIG.${unit(s)}.STATUS`, elementType: 'SIGNAL', name: `${s.name} 상태 신호`, version: s.version, sourceSystem: 'IDT' },
        { kind, elementId: `EVT.${unit(s)}.FAULT`, elementType: 'EVENT', name: `${s.name} 고장 이벤트`, version: s.version, sourceSystem: 'IDT' },
      ]),
      ...ecu.map((e) => ({ kind, elementId: `DTC-${e.ecuPno}-01`, elementType: 'DTC', name: `${e.name} 통신 이상`, version: e.hwRevision, sourceSystem: 'IDT' })),
    ];
  }

  /** 식별자 하나 찾기 — 버전을 주면 그 버전, 없으면 가장 새 버전. 없으면 null */
  find(kind: TraceKind, elementId: string, version?: string | null): { element: SourceElement | null; versions: string[] } {
    this.need(kind);
    const hits = this.catalog(kind).filter((e) => e.elementId === elementId);
    const versions = [...new Set(hits.map((h) => h.version))].sort((a, b) => (/^\d/.test(a) && /^\d/.test(b) ? compareVersion(a, b) : a < b ? -1 : 1));
    const element = version ? (hits.find((h) => h.version === version) ?? null) : (hits.find((h) => h.version === versions.at(-1)) ?? null);
    return { element, versions };
  }

  /** 등록 때의 출처 확인 — 외부 연계 호출 기록에 남긴다(같은 연결은 처음 응답) */
  verify(kind: TraceKind, linkId: string, elementId: string, version: string | null) {
    const found = this.find(kind, elementId, version);
    const ifId = IF_OF[kind];
    const key = `trace:${linkId}:${kind}:${elementId}@${version ?? ''}`;
    this.calls.call(ifId, key, { kind, elementId, version }, () => ({ found: !!found.element, element: found.element, versions: found.versions }));
    return { ...found, ref: `${ifId}:${key}` };
  }

  /** ALM의 Feature 전체 요구 — 시스템 요구(Feature 요구 식별자)와 그 Feature SW의 SW 요구(커버리지 분모, FR-DEP-005-004) */
  requirementsOf(featureId: string): { reqId: string; type: 'SYSTEM' | 'SW' }[] {
    const f = this.latest(featureId);
    if (!f) return [];
    const sys = (f.requirementIds ?? []).map((reqId) => ({ reqId, type: 'SYSTEM' as const }));
    const sw = f.swIds
      .map((swId, i) => this.topology.sw(swId, f.swVersions[i] ?? '')[0])
      .filter((s): s is NonNullable<typeof s> => !!s && !!s.requirementId)
      .map((s) => ({ reqId: s.requirementId, type: 'SW' as const }));
    const seen = new Set<string>();
    return [...sys, ...sw].filter((r) => !seen.has(r.reqId) && !!seen.add(r.reqId));
  }

  latest(featureId: string): FeatureVersionRow | undefined {
    return this.features.versions(featureId).at(-1);
  }
}
