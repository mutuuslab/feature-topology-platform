// 외부 연계 모의 어댑터 — IF-01 ALM · IF-02 기준정보 · IF-03 MDM/DW · IF-08 Supplier Portal · IF-11 OpenTelemetry Collector · IF-12 해외공장.
// 실제 시스템 대신 데이터셋·픽스처에서 결정적으로 응답하고, 호출마다 if_call에 남긴다(같은 멱등 키는 처음 응답을 돌려줌).
// 연결 방식은 IF_MODE_<번호>(예: IF_MODE_12=off)로 끌 수 있다 — 꺼진 IF를 부르면 GUARD_FAILED(연계 불가)로 실패한다.
import { Inject, Injectable } from '@nestjs/common';
import { INTERFACES, MOCK_IFS, type IfSystemStatus, type LegacyMapping, type LegacyVehicle, type MockIf, type OtelSpan, type PlantOrder } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { DomainError } from '../../kernel/errors';
import { FleetRepo } from '../../domains/d01-policy/policy-repos';
import { FeatureRepo, TopologyRepo } from '../../domains/d01-policy/repos';
import { IfCallRepo } from '../if-call/if-call.repo';
import { OtelExporter } from './otel.exporter';
import { modeOf } from '../../domains/d05-ext/api-gateway/ext-sync/adapters';
import { seedOf } from '../../kernel/runtime-config';

export const EXT_FIXTURES = join(__dirname, '..', '..', '..', '..', 'data', 'fixtures', 'ext');
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(process.env.FF_EXT_FIXTURES ?? EXT_FIXTURES, `${name}.json`), 'utf8'));
/** 모의 외부 시스템의 예시 내용(해외공장 주문·레거시 옵션 코드·비SDV 차량·VOC) — 데모 데이터(시드)와 한 묶음이다.
 *  시드 없이 띄운 설치(고객 운영·빈 DB 첫 실행)에서는 그 고객의 외부 시스템에 아직 아무것도 없다 — 빈 목록(출시 준비 RD-OPS-02).
 *  시험은 FF_EXT_FIXTURES로 직접 고른 픽스처를 그대로 받는다. */
export const sampleFixture = <T>(name: string, env: Record<string, string | undefined> = process.env): T[] => (seedOf(env) === 'none' && !env.FF_EXT_FIXTURES ? [] : fixture<T[]>(name));

export interface VocItem {
  ref: string;
  vin: string;
  featureName: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  text: string;
}

/** 각 IF를 쓰는 컴포넌트 (manifest IF 칸과 같은 값) */
const USERS: Record<string, string[]> = {
  'IF-01': ['D01-01', 'D05-01'],
  'IF-02': ['D05-01', 'D05-02'],
  'IF-03': ['D05-01', 'D05-02'],
  'IF-04': ['D01-06'],
  'IF-05': ['D04-01'],
  'IF-06': ['D04-03'],
  'IF-07': ['D02-03'],
  'IF-08': ['D05-01'],
  'IF-09': ['D04-02'],
  'IF-10': ['D05-01'],
  'IF-11': ['D04-03', 'D04-04'],
  'IF-12': ['D05-02', 'D05-03'],
  'IF-13': ['D04-01', 'D05-01'],
  'IF-14': ['D05-01'],
};

@Injectable()
export class ExternalSystems {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly calls: IfCallRepo,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly fleet: FleetRepo,
    private readonly otel: OtelExporter,
  ) {}

  mode(ifId: MockIf): 'mock' | 'off' {
    return process.env[`IF_MODE_${ifId.slice(3)}`] === 'off' ? 'off' : 'mock';
  }

  private need(ifId: MockIf) {
    if (this.mode(ifId) === 'off') throw new DomainError('GUARD_FAILED', `${ifId} ${INTERFACES[ifId]} 연계가 꺼져 있습니다 (IF_MODE_${ifId.slice(3)}=off).`, { ifId });
  }

  /** IF-01 ALM — Feature Version의 요구사항(데이터셋 requirementIds)과 추적(G2 Gate 기록) */
  almRequirements(featureId: string, version: string) {
    this.need('IF-01');
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    return this.calls.call('IF-01', `${featureId}@${version}`, { featureId, version }, () => ({
      featureId,
      version,
      system: 'ALM (모의)',
      items: (f.requirementIds ?? []).map((reqId, i) => ({ reqId, title: `${f.name} — 요구사항 ${i + 1}`, status: 'APPROVED', tracedGate: 'G2', baseline: f.baselineId })),
    }));
  }

  /** IF-02 기준정보 — 외부 PLM의 ECU 마스터(플랫폼 사본과 일부 다름: 하드웨어 개정·신규 ECU·폐기 ECU) */
  ecuMaster(runKey: string) {
    this.need('IF-02');
    return this.calls.call('IF-02', `ecu:${runKey}`, { kind: 'ECU_MASTER' }, () => {
      const rows = this.topology.allEcu().map((e) => ({ ...e })) as Record<string, unknown>[];
      if (rows[0]) rows[0] = { ...rows[0], hwRevision: `${rows[0].hwRevision ?? 'A'}-R2` };
      rows.pop(); // PLM에서 폐기된 ECU
      rows.push({ ecuPno: '99999-NX400', name: '통합 존 제어기(신규)', hwRevision: 'A', supplier: 'Mutuus Lab', asil: 'B' });
      return rows;
    });
  }

  /** IF-02 기준정보 — 차량 사양(UPG-VC·트림) 마스터 */
  vehicleSpecs(runKey: string) {
    this.need('IF-02');
    return this.calls.call('IF-02', `vehicle:${runKey}`, { kind: 'VEHICLE_SPEC' }, () => {
      const rows = this.fleet.vehicles().map((v) => ({ vin: v.vin, vehicleModel: v.vehicleModel, trim: v.trim, upgVc: v.upgVc })) as Record<string, unknown>[];
      const i = rows.findIndex((r) => r.vin === 'KMH-NX4-0003');
      if (i >= 0) rows[i] = { ...rows[i], trim: 'Inspiration' }; // 사양 변경이 PLM에만 반영됨
      return rows.filter((r) => !String(r.vin).startsWith('ego-') && !String(r.vin).startsWith('lead-')); // 시연 차량은 PLM에 없음
    });
  }

  /** IF-03 MDM/DW — DW에 적재된 Feature Lifecycle 사본(마지막 적재 이후 바뀐 것은 옛 값) */
  dwFeatures(runKey: string) {
    this.need('IF-03');
    return this.calls.call('IF-03', `dw:${runKey}`, { kind: 'FEATURE_LIFECYCLE' }, () =>
      this.features.all().map((f, i) => ({ key: `${f.featureId}@${f.version}`, lifecycle: i % 17 === 3 ? 'VERIFIED' : f.lifecycle, baselineId: f.baselineId })),
    );
  }

  /** IF-08 Supplier Portal — 협력사 SW 납품(SW 마스터의 공급사·체크섬) */
  supplierDeliveries(supplier?: string) {
    this.need('IF-08');
    return this.calls.call('IF-08', `deliveries:${supplier ?? '*'}`, { supplier: supplier ?? null }, () =>
      this.topology
        .allSw()
        .filter((s) => !supplier || s.supplier === supplier)
        .map((s) => ({ swId: s.swId, version: s.version, supplier: s.supplier, artifactId: s.artifactId, checksum: s.checksum, ecuPno: s.ecuPno, lifecycle: s.lifecycle })),
    );
  }

  /** IF-12 해외공장 — 생산 주문(레거시 옵션 코드) */
  plantOrders(plant: string): PlantOrder[] {
    this.need('IF-12');
    return this.calls.call('IF-12', `orders:${plant}`, { plant }, () => sampleFixture<PlantOrder>('plantOrders').filter((o) => o.plant === plant));
  }

  /** IF-12 해외공장 — 생산 차량(VIN) 목록 */
  plantVehicles(plant: string, runKey: string) {
    this.need('IF-12');
    return this.calls.call('IF-12', `vehicles:${plant}:${runKey}`, { plant }, () => sampleFixture<PlantOrder>('plantOrders').filter((o) => o.plant === plant).map((o) => ({ vin: o.vin, vehicleModel: o.vehicleModel })));
  }

  /** IF-11 OpenTelemetry Collector — span 받기(모의 수집기는 표에 쌓는다) */
  exportSpans(spans: OtelSpan[]) {
    return this.otel.export(spans);
  }

  spans(q: { name?: string; limit?: number } = {}): OtelSpan[] {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const rows = q.name ? this.db.all<{ doc: string }>('SELECT doc FROM otel_span WHERE name = ? ORDER BY id DESC LIMIT ?', q.name, limit) : this.db.all<{ doc: string }>('SELECT doc FROM otel_span ORDER BY id DESC LIMIT ?', limit);
    return rows.map((r) => JSON.parse(r.doc));
  }

  /** 고객센터 VOC 원천(모의) — 연계 IF 번호 없음(D04-05 자체 수집) */
  vocFeed(): VocItem[] {
    return sampleFixture<VocItem>('voc');
  }

  legacyMappings(): LegacyMapping[] {
    return sampleFixture<LegacyMapping>('legacyMappings');
  }

  legacyVehicles(): LegacyVehicle[] {
    return sampleFixture<LegacyVehicle>('legacyVehicles');
  }

  /** IF-01~13 연결 현황 — 모의 어댑터는 mock/off, 나머지는 각 어댑터의 환경 변수 기준 */
  systems(): IfSystemStatus[] {
    const count = (ifId: string) => this.db.get<{ n: number; at: string | null }>('SELECT count(*) AS n, max(at) AS at FROM if_call WHERE if_id = ?', ifId)!;
    const spanCount = this.db.get<{ n: number; at: string | null }>('SELECT count(*) AS n, max(at) AS at FROM otel_span')!;
    const other: Record<string, Pick<IfSystemStatus, 'mode' | 'adapter'>> = {
      'IF-04': { mode: (process.env.UNLEASH_MODE as IfSystemStatus['mode']) ?? 'mock', adapter: 'adapters/unleash (Unleash OSS 8.2 Admin API)' },
      'IF-05': { mode: 'mock', adapter: 'pipeline-link (CCS·OTA 캠페인 모의)' },
      'IF-06': { mode: (process.env.GLEO_MODE as IfSystemStatus['mode']) ?? 'internal', adapter: 'adapters/gleo · 차량 보고 채널' },
      'IF-07': { mode: (process.env.GLEO_MODE as IfSystemStatus['mode']) ?? 'internal', adapter: 'adapters/gleo (정책·차단 전달)' },
      'IF-09': { mode: 'mock', adapter: 'tms (검증 Gate 제출 모의)' },
      'IF-10': { mode: 'internal', adapter: 'OFREP /ofrep/v1 · /vehicle/v1' },
      'IF-13': { mode: modeOf('GITLAB'), adapter: 'pipeline-link (CI/CD 산출물) · ext-sync (GitLab MR·파이프라인 양방향)' },
      'IF-14': { mode: modeOf('JIRA'), adapter: 'ext-sync (JIRA Epic·CR 양방향)' },
    };
    return Object.entries(INTERFACES).map(([ifId, name]) => {
      const mock = (MOCK_IFS as readonly string[]).includes(ifId);
      const c = ifId === 'IF-11' ? spanCount : ifId === 'IF-10' ? { n: 0, at: null } : count(ifId);
      return {
        ifId,
        name,
        mode: mock ? this.mode(ifId as MockIf) : other[ifId]?.mode ?? 'mock',
        adapter: mock ? `adapters/if-mocks (${ifId} 모의)` : other[ifId]?.adapter ?? '—',
        components: USERS[ifId] ?? [],
        calls: c.n,
        lastAt: c.at,
      };
    });
  }

  now() {
    return this.clock.iso();
  }
}
