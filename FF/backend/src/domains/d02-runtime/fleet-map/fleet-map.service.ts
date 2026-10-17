// 전세계 차량 지도 (D02-03) — 차량별 위치·구독 상태·기능 활성. 상태는 차량 런타임·사용 권한에서, 위치는 모의 공급자(contracts/rules/fleet-map)에서 온다.
// 위치는 개인정보다(D5 결정 대기): 지도 목록은 약 1 km로 낮추고, 정밀 위치는 한 대 상세에서만 주며 열람마다 감사한다. 위치는 저장하지 않는다.
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import {
  activationState,
  clusterCellDeg,
  clusterize,
  coarsen,
  DETAIL_PRECISION_DEG,
  inBbox,
  inService,
  LOCATION_PRECISION_LABEL,
  LOCATION_VIEW_ROLES,
  locationConsent,
  MAP_AUDIT_WINDOW_MS,
  MAP_POINT_LIMIT,
  MAP_PRECISION_DEG,
  MAP_PRIVACY_NOTE,
  mockPosition,
  parseBbox,
  PRECISION_ACCURACY_M,
  regionPoint,
  regionsOf,
  subscriptionState,
  summarize,
  SYNTHETIC_SPREAD_KM,
  weightOf,
  type Entitlement,
  type FleetMapPosition,
  type FleetMapVehicle,
  type LocationPrecision,
  type VehicleProfile,
} from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { ProductRepo } from '../../d01-policy/repos';
import { VehicleRuntimeService } from '../vehicle-runtime/vehicle-runtime.service';

type RuntimeRow = Awaited<ReturnType<VehicleRuntimeService['fleetStatus']>>['items'][number];
export type MapSource = 'DEMO' | 'SYNTHETIC' | 'ALL';
const asMapSource = (s?: string): MapSource => (s === 'SYNTHETIC' || s === 'ALL' ? s : 'DEMO');

export const MAP_PROVIDER = '데모 모의 위치 공급자 (국가·지역 도시 주변, VIN 결정적 — 실차 위치 아님)';

@Injectable()
@PlatformComponent('D02-03')
export class FleetMapService {
  /** 계정별 마지막 지도 열람 감사 시각 */
  private readonly lastMapAudit = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly runtime: VehicleRuntimeService,
    private readonly entitlements: EntitlementService,
    private readonly products: ProductRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private position(vin: string, country: string, region: string, moving: boolean, step: number, precise: LocationPrecision, spreadKm?: number): FleetMapPosition | null {
    if (!locationConsent(vin)) {
      const r = regionPoint(country, region);
      return r && { ...r, precision: 'REGION', accuracyM: PRECISION_ACCURACY_M.REGION, heading: null };
    }
    const p = mockPosition(vin, country, region, this.clock.now().getTime(), moving, spreadKm);
    if (!p) return null;
    const [lat, lng] = coarsen(p.lat, p.lng, step);
    return { lat, lng, city: p.city, heading: p.heading, precision: precise, accuracyM: PRECISION_ACCURACY_M[precise] };
  }

  private demoVehicle(r: RuntimeRow, profiles: Map<string, VehicleProfile>, today: string, q: { catalogId?: string; flagKey?: string }, precise: boolean): FleetMapVehicle {
    const v = this.fleet.vehicle(r.vin)!;
    const region = profiles.get(r.vin)?.region ?? regionsOf(v.country)[0] ?? '';
    // 오프라인 차량은 마지막 보고 위치에 멈춰 있다
    const moving = r.link === 'ONLINE';
    return {
      vin: r.vin,
      label: r.label,
      source: 'DEMO',
      country: v.country,
      region,
      vehicleModel: v.vehicleModel,
      trim: v.trim,
      position: this.position(r.vin, v.country, region, moving, precise ? DETAIL_PRECISION_DEG : MAP_PRECISION_DEG, precise ? 'PRECISE' : 'COARSE'),
      moving,
      stale: !moving,
      link: r.link,
      subscription: subscriptionState(this.fleet.grants(r.vin), today, q.catalogId),
      activation: activationState(r, q.flagKey),
      kills: r.kills,
    };
  }

  private syntheticVehicle(p: VehicleProfile, grants: Entitlement[], today: string, catalogId: string | undefined, precise: boolean): FleetMapVehicle {
    return {
      vin: p.vin,
      label: null,
      source: 'SYNTHETIC',
      country: p.country,
      region: p.region,
      vehicleModel: p.vehicleModel,
      trim: p.trim,
      position: this.position(p.vin, p.country, p.region, false, precise ? DETAIL_PRECISION_DEG : MAP_PRECISION_DEG, precise ? 'PRECISE' : 'COARSE', SYNTHETIC_SPREAD_KM),
      moving: false,
      stale: false,
      link: null,
      subscription: subscriptionState(grants, today, catalogId),
      activation: null,
      kills: [],
      weight: weightOf(p),
    };
  }

  private auditMap(actor: Actor, q: { source: MapSource; catalogId?: string; flagKey?: string }, count: number) {
    const now = this.clock.now().getTime();
    const last = this.lastMapAudit.get(actor.id);
    if (last !== undefined && now - last < MAP_AUDIT_WINDOW_MS) return false;
    this.lastMapAudit.set(actor.id, now);
    this.db.tx(() => this.audit.record(actor, 'FLEET_LOCATION_VIEW', '/api/fleet/map', { after: { ...q, vehicles: count, precision: 'COARSE' }, reason: '전세계 차량 지도 열람(약 1 km)', componentId: 'D02-03' }));
    return true;
  }

  /**
   * 지도 — 데모 차량은 항상 점으로. 합성·표본 차량은 화면 범위(bbox) 안이 MAP_POINT_LIMIT 이하일 때만 점으로 보내고,
   * 늘 격자 집계(clusters, 대표 대수)를 함께 보낸다. 국가별 요약은 범위와 관계없이 전체(가중) 기준이다.
   */
  async map(actor: Actor, q: { source?: string; catalogId?: string; flagKey?: string; zoom?: string; bbox?: string }) {
    const source = asMapSource(q.source);
    const catalogId = q.catalogId || undefined;
    const flagKey = q.flagKey || undefined;
    const zoom = Number.isFinite(Number(q.zoom)) && q.zoom !== undefined && q.zoom !== '' ? Number(q.zoom) : 1;
    const bbox = parseBbox(q.bbox);
    const today = this.entitlements.today();
    const profiles = this.fleet.profiles();
    const items: FleetMapVehicle[] = [];
    const synthetic: FleetMapVehicle[] = [];
    let flagKeys: string[] = [];
    if (source !== 'SYNTHETIC') {
      const rt = await this.runtime.fleetStatus('DEMO');
      flagKeys = [...new Set(rt.items.flatMap((r) => r.flags.map((f) => f.flagKey)))].sort();
      for (const r of rt.items) items.push(this.demoVehicle(r, profiles, today, { catalogId, flagKey }, false));
    }
    const syn = this.fleet.syntheticGrants();
    if (source !== 'DEMO') {
      for (const p of profiles.values()) if (p.source === 'SYNTHETIC' && inService(p, today)) synthetic.push(this.syntheticVehicle(p, syn.byVin.get(p.vin) ?? [], today, catalogId, false));
    }
    const all = [...items, ...synthetic];
    const inView = synthetic.filter((v) => v.position && inBbox(v.position, bbox));
    const points = inView.length <= MAP_POINT_LIMIT ? inView : [];
    const used = new Set([...(source !== 'SYNTHETIC' ? this.fleet.grants(undefined, 'DEMO') : []), ...(source !== 'DEMO' ? syn.grants : [])].map((g) => g.catalogId));
    const catalogs = this.products
      .all()
      .filter((p) => used.has(p.catalogId))
      .map((p) => ({ catalogId: p.catalogId, name: p.name }))
      .sort((a, b) => a.catalogId.localeCompare(b.catalogId));
    const represented = Math.round(all.reduce((t, v) => t + (v.weight ?? 1), 0));
    const audited = this.auditMap(actor, { source, catalogId, flagKey }, represented);
    return {
      generatedAt: this.clock.iso(),
      source,
      catalogId: catalogId ?? null,
      flagKey: flagKey ?? null,
      flagKeys,
      catalogs,
      precision: { level: 'COARSE' as const, label: LOCATION_PRECISION_LABEL.COARSE, degrees: MAP_PRECISION_DEG },
      provider: MAP_PROVIDER,
      privacy: MAP_PRIVACY_NOTE,
      audited,
      items: [...items, ...points],
      /** 범위 안 표본이 상한을 넘어 점으로 보내지 않은 수(0이면 범위 안 전부 보냄) */
      pointsOmitted: inView.length - points.length,
      clusters: clusterize(all.filter((v) => v.source === 'SYNTHETIC'), clusterCellDeg(zoom)),
      represented,
      summary: summarize(all),
    };
  }

  /** 한 대 상세 — 정밀 위치. 열람마다 감사한다 */
  async vehicle(actor: Actor, vin: string) {
    const today = this.entitlements.today();
    const profiles = this.fleet.profiles();
    let item: FleetMapVehicle;
    let runtime: Pick<RuntimeRow, 'featureState' | 'flags' | 'last' | 'quality' | 'gleo'> | null = null;
    if (this.fleet.vehicle(vin) && this.fleet.vehicle(vin)!.fleet !== 'SAMPLE') {
      const rt = await this.runtime.fleetStatus();
      const r = rt.items.find((x) => x.vin === vin)!;
      item = this.demoVehicle(r, profiles, today, {}, true);
      runtime = { featureState: r.featureState, flags: r.flags, last: r.last, quality: r.quality, gleo: r.gleo };
    } else {
      const p = profiles.get(vin);
      if (!p || p.source !== 'SYNTHETIC') throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
      item = this.syntheticVehicle(p, this.fleet.grants(vin), today, undefined, true);
    }
    this.db.tx(() => this.audit.record(actor, 'FLEET_LOCATION_VIEW', `/api/fleet/map/vehicles/${vin}`, { after: { vin, precision: item.position?.precision ?? null }, reason: '차량 정밀 위치 열람', componentId: 'D02-03' }));
    return {
      vehicle: item,
      grants: this.entitlements.grants(vin),
      runtime,
      provider: MAP_PROVIDER,
      privacy: MAP_PRIVACY_NOTE,
      audited: true,
    };
  }
}

@Controller('api/fleet/map')
export class FleetMapController {
  constructor(private readonly s: FleetMapService) {}

  @Get()
  @Roles(...LOCATION_VIEW_ROLES)
  map(@CurrentActor() actor: Actor, @Query('source') source?: string, @Query('catalogId') catalogId?: string, @Query('flagKey') flagKey?: string, @Query('zoom') zoom?: string, @Query('bbox') bbox?: string) {
    return this.s.map(actor, { source, catalogId, flagKey, zoom, bbox });
  }

  @Get('vehicles/:vin')
  @Roles(...LOCATION_VIEW_ROLES)
  vehicle(@CurrentActor() actor: Actor, @Param('vin') vin: string) {
    return this.s.vehicle(actor, vin);
  }
}
