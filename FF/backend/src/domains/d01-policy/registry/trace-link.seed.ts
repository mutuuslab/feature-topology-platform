// 추적 연결 데모 시드(P3) — 데이터셋 Feature마다 요구·SW·ECU·인터페이스·Test Case·OTA 패키지 연결과 Lifecycle에 맞는 Test Evidence.
// 결정적이다(Feature 번호로 고름). 일부 Feature는 요구를 잇지 않고(요구 미연결 목록), 일부 SW 요구는 빠지고(부분 커버리지),
// 개발 중 Feature는 필수 Test Case 일부만 Evidence가 있다(필수 Evidence 미등록 목록).
import { compareVersion, type FeatureVersionRow, type TestEvidenceRow, type TraceLinkRow } from '@ff/contracts';
import type { TraceSources } from '../../../adapters/if-mocks/trace-sources';

const pad = (n: number) => String(n).padStart(5, '0');
const DONE = new Set(['VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED']);

export function traceSeed(features: FeatureVersionRow[], sources: Pick<TraceSources, 'catalog' | 'requirementsOf'>, now: Date): { links: TraceLinkRow[]; evidence: TestEvidenceRow[] } {
  const latest = new Map<string, FeatureVersionRow>();
  for (const f of features) if (!latest.has(f.featureId) || compareVersion(latest.get(f.featureId)!.version, f.version) < 0) latest.set(f.featureId, f);
  if (!latest.size) return { links: [], evidence: [] };
  const cat = {
    ARCHITECTURE: sources.catalog('ARCHITECTURE'),
    INTERFACE: sources.catalog('INTERFACE'),
    TEST_CASE: sources.catalog('TEST_CASE'),
    OTA: sources.catalog('OTA'),
  };
  const links: TraceLinkRow[] = [];
  const evidence: TestEvidenceRow[] = [];
  const seen = new Set<string>();
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const add = (f: FeatureVersionRow, o: Pick<TraceLinkRow, 'kind' | 'elementId' | 'elementType' | 'sourceSystem'> & Partial<TraceLinkRow>, by: string, ago: number) => {
    const key = `${f.featureId}|${o.kind}|${o.elementId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const row: TraceLinkRow = {
      linkId: `TRL-${pad(links.length + 1)}`,
      featureId: f.featureId,
      elementName: null,
      elementVersion: null,
      required: null,
      existence: o.kind === 'REQUIREMENT' ? 'NOT_CHECKED' : 'VERIFIED',
      sourceRef: null,
      status: 'ACTIVE',
      linkedBy: by,
      linkedAt: day(ago),
      unlinkedBy: null,
      unlinkedAt: null,
      unlinkReason: null,
      ...o,
    };
    links.push(row);
    return row;
  };
  for (const f of [...latest.values()].sort((a, b) => (a.featureId < b.featureId ? -1 : 1))) {
    const n = Number(f.featureId.slice(5));
    // 요구 — 7개 중 1개 Feature는 아직 잇지 않았다. SW 요구는 3개 중 2개 Feature만
    if (n % 7 !== 3)
      for (const r of sources.requirementsOf(f.featureId))
        if (r.type === 'SYSTEM' || n % 3 !== 1) add(f, { kind: 'REQUIREMENT', elementId: r.reqId, elementType: r.type, sourceSystem: r.type === 'SYSTEM' ? 'CODEBEAMER' : 'ALM' }, 'usr-author', 40);
    // 설계 요소 — SW(버전 포함)·ECU(HW)
    f.swIds.forEach((swId, i) => {
      const sw = cat.ARCHITECTURE.find((e) => e.elementType === 'SW' && e.elementId === swId && e.version === f.swVersions[i]);
      if (sw) add(f, { kind: 'ARCHITECTURE', elementId: sw.elementId, elementType: 'SW', elementName: sw.name, elementVersion: sw.version, sourceSystem: 'PLM' }, 'usr-integrator', 35);
      // OTA 패키지 — 같은 SW의 패키지
      const pkg = cat.OTA.find((e) => e.name === sw?.name && e.version === sw?.version);
      if (pkg) add(f, { kind: 'OTA', elementId: pkg.elementId, elementType: 'SW_PACKAGE', elementName: pkg.name, elementVersion: pkg.version, sourceSystem: 'SW_REPO' }, 'usr-integrator', 20);
    });
    for (const ecuPno of new Set(f.ecuPnos)) {
      const hw = cat.ARCHITECTURE.find((e) => e.elementType === 'HW' && e.elementId === ecuPno);
      if (hw) add(f, { kind: 'ARCHITECTURE', elementId: hw.elementId, elementType: 'HW', elementName: hw.name, elementVersion: hw.version, sourceSystem: 'PLM' }, 'usr-integrator', 35);
    }
    // 인터페이스 — 첫 SW의 서비스 API·상태 Signal, 제어점에 DTC가 있으면 ECU DTC, 짝수 번호는 고장 Event
    const first = f.swIds[0] ? cat.ARCHITECTURE.find((e) => e.elementType === 'SW' && e.elementId === f.swIds[0]) : undefined;
    const unitOf = first ? cat.INTERFACE.filter((e) => e.version === first.version && e.name.startsWith(first.name)) : [];
    for (const e of unitOf.filter((x) => x.elementType === 'API' || x.elementType === 'SIGNAL' || (x.elementType === 'EVENT' && n % 2 === 0)))
      add(f, { kind: 'INTERFACE', elementId: e.elementId, elementType: e.elementType, elementName: e.name, elementVersion: e.version, sourceSystem: 'IDT' }, 'usr-integrator', 30);
    if (f.controlPoints.includes('DTC') && f.ecuPnos[0]) {
      const dtc = cat.INTERFACE.find((e) => e.elementType === 'DTC' && e.elementId === `DTC-${f.ecuPnos[0]}-01`);
      if (dtc) add(f, { kind: 'INTERFACE', elementId: dtc.elementId, elementType: 'DTC', elementName: dtc.name, elementVersion: dtc.version, sourceSystem: 'IDT' }, 'usr-integrator', 30);
    }
    // Test Case — 기능·회귀는 필수, 가상 주행은 ASIL이면 필수, 실차는 선택
    const tcs = cat.TEST_CASE.filter((e) => e.elementId.startsWith(`TC-${f.featureId.slice(5)}-`));
    const plan: [string, boolean][] = [['01', true], ['02', true], ['03', f.asil !== 'QM'], ['05', false]];
    const tcLinks = plan
      .map(([no, required]) => {
        const tc = tcs.find((e) => e.elementId.endsWith(`-${no}`));
        return tc ? add(f, { kind: 'TEST_CASE', elementId: tc.elementId, elementType: tc.elementType, elementName: tc.name, elementVersion: tc.version, sourceSystem: 'TMS', required }, 'usr-quality', 25) : null;
      })
      .filter((x): x is TraceLinkRow => !!x);
    // Evidence — 검증을 마친 Feature는 필수 전부, 개발 중이면 첫 Test Case만, 11개 중 1개는 회귀 시험 최종 실패
    const withEvidence = DONE.has(f.lifecycle) ? tcLinks : f.lifecycle === 'DEVELOPING' ? tcLinks.slice(0, 1) : [];
    for (const [i, l] of withEvidence.entries()) {
      const fail = l.elementId.endsWith('-02') && n % 11 === 5;
      evidence.push({
        recordId: `TEV-${pad(evidence.length + 1)}`,
        linkId: l.linkId,
        featureId: f.featureId,
        testCaseId: l.elementId,
        evidenceId: `EV-${l.elementId}-R${i + 1}`,
        executedAt: day(10 - i),
        result: fail ? 'FAIL' : 'PASS',
        environment: l.elementType === 'VIRTUAL' ? 'CARLA 가상 주행' : l.elementType === 'VEHICLE' ? '시험차 NX4-T07' : 'HIL 벤치 2',
        registeredBy: 'usr-quality',
        registeredAt: day(9 - i),
      });
    }
  }
  return { links, evidence };
}
