// 보안 취약점 모니터링 (D06-11, 보고서 v1.1 15장) — 배포 단위(서명 게시본)마다 CycloneDX 1.6 SBOM을 만들어 저장하고(030_sbom, 추가만),
// 서명 직전에 SBOM 대상 해시와 패키지 해시를 대조한다(보안 배포 D06-08이 부른다). 원산지 속성 누락은 배포를 막지 않고 발견으로 남긴다
// (데이터셋 SW 목록에 국가가 없다 — 값을 만들지 않는다). VEX 판정은 저장된 SBOM으로 영향 Feature를 특정하고 이벤트로 알린다.
import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { originErrors, sbomBinding, sbomErrors, VexStatement, vexImpact, type CdxBom, type CdxComponent } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { MARKETS } from '@ff/contracts';

const marketOf = (country: string) => ((MARKETS as readonly string[]).includes(country) ? country : 'OTHER');

/** 플랫폼 쪽 Feature Flag 구성요소 — 게시본을 만들고 서명한 SW */
const PLATFORM = { name: 'ff-platform', version: '0.81.0', developer: 'Mutuus Lab' };
const uuidOf = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

@Injectable()
@PlatformComponent('D06-11')
export class SbomService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 게시본 SBOM — 대상(metadata.component) = 서명할 패키지(해시 = payloadHash), 구성요소 = Feature Version의 SW·플랫폼 */
  build(publicationId: string, featureId: string, featureVersion: string, packageHash: string): CdxBom {
    const f = this.features.get(featureId, featureVersion);
    const sw: CdxComponent[] = (f?.swIds ?? []).flatMap((id, i) =>
      this.topology.sw(id, f!.swVersions?.[i] ?? f!.swVersions?.[0] ?? '').map((s) => ({
        'bom-ref': `${s.swId}@${s.version}`,
        type: s.swType === 'Firmware' ? ('firmware' as const) : ('application' as const),
        name: s.name,
        version: s.version,
        purl: `pkg:generic/hmg/${s.swId.toLowerCase()}@${s.version}`,
        properties: [
          { name: 'ffp:category', value: 'FF' }, // Feature Flag를 소비하는 SW(SEC-006 대상)
          { name: 'ffp:origin:developer', value: s.supplier ?? '' },
          { name: 'ffp:owner', value: s.owner ?? '' },
          { name: 'ffp:checksum:declared', value: (s as { checksum?: string }).checksum ?? '' },
        ],
      })),
    );
    const platform: CdxComponent = {
      'bom-ref': `${PLATFORM.name}@${PLATFORM.version}`,
      type: 'application',
      name: PLATFORM.name,
      version: PLATFORM.version,
      purl: `pkg:generic/mutuus-lab/${PLATFORM.name}@${PLATFORM.version}`,
      properties: [{ name: 'ffp:category', value: 'FF' }, { name: 'ffp:origin:developer', value: PLATFORM.developer }],
    };
    const pkg = packageHash.replace(/^sha256:/, '');
    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: `urn:uuid:${uuidOf(`${publicationId}|${pkg}`)}`,
      version: 1,
      metadata: {
        timestamp: this.clock.iso(),
        component: { 'bom-ref': publicationId, type: 'application', name: `${featureId}-${publicationId}`, version: featureVersion, hashes: [{ alg: 'SHA-256', content: pkg }] },
      },
      components: [platform, ...sw],
      dependencies: [{ ref: publicationId, dependsOn: [platform['bom-ref'], ...sw.map((c) => c['bom-ref'])] }],
    };
  }

  /**
   * 서명 전 검사·저장 — 구조 위반이나 해시 불일치면 던지고(호출자 트랜잭션 롤백 → 서명된 게시본이 남지 않는다) 저장하지 않는다.
   * @rule FFG-SBOM-002, FFG-SBOM-003 — 생성 SBOM은 스키마 통과분만 저장, 패키지 해시와 결합된 SBOM이 있어야 서명·배포
   */
  attach(publicationId: string | null, featureId: string, featureVersion: string, bom: CdxBom, packageHash: string): CdxBom {
    const errors = sbomErrors(bom);
    if (errors.length) throw new DomainError('GUARD_FAILED', `SBOM 스키마 위반 — 저장·서명하지 않습니다: ${errors.slice(0, 3).join('; ')}`, { errors });
    const b = sbomBinding(bom, packageHash);
    if (!b.ok) throw new DomainError('GUARD_FAILED', b.message, { rule: 'FFG-SBOM-003' });
    this.db.run(
      'INSERT INTO sbom (serial, publication_id, feature_id, feature_version, package_hash, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)',
      bom.serialNumber,
      publicationId,
      featureId,
      featureVersion,
      packageHash.replace(/^sha256:/, ''),
      this.clock.iso(),
      JSON.stringify(bom),
    );
    return bom;
  }

  private rows(featureId?: string) {
    return this.db
      .all<{ serial: string; publication_id: string | null; feature_id: string; feature_version: string; package_hash: string; created_at: string; doc: string }>(
        `SELECT * FROM sbom ${featureId ? 'WHERE feature_id = ?' : ''} ORDER BY created_at, serial`,
        ...(featureId ? [featureId] : []),
      )
      .map((r) => ({ ...r, bom: JSON.parse(r.doc) as CdxBom }));
  }

  /** 목록 — 원산지 누락은 발견으로(FFG-SEC-006·SBOM-007), 시장은 Feature 국가 */
  list(featureId?: string) {
    return this.rows(featureId).map((r) => {
      const market = marketOf(this.features.get(r.feature_id, r.feature_version)?.country ?? '');
      return { serial: r.bom.serialNumber, publicationId: r.publication_id, featureId: r.feature_id, featureVersion: r.feature_version, packageHash: r.package_hash, createdAt: r.created_at, components: r.bom.components.length, market, originFindings: originErrors(r.bom, [market]) };
    });
  }

  get(serial: string): CdxBom {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM sbom WHERE serial = ?', serial);
    if (!r) throw new DomainError('NOT_FOUND', `SBOM ${serial}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc) as CdxBom;
  }

  /** VEX 판정 기록 — Feature Version별 최신 SBOM으로 영향 Feature를 특정한다 */
  recordVex(actor: Actor, body: VexStatement) {
    const latest = new Map<string, { featureId: string; featureVersion: string; bom: CdxBom }>();
    for (const r of this.rows()) latest.set(`${r.feature_id}@${r.feature_version}`, { featureId: r.feature_id, featureVersion: r.feature_version, bom: r.bom });
    const impact = vexImpact(body, [...latest.values()]);
    return this.db.tx(() => {
      this.db.run('INSERT INTO vex (vuln_id, state, at, doc) VALUES (?, ?, ?, ?)', body.vulnId, body.state, this.clock.iso(), JSON.stringify({ statement: body, impact, by: actor.id }));
      this.audit.record(actor, 'VEX_RECORD', body.vulnId, { after: { state: body.state, affects: body.affects, features: impact.features.map((f) => `${f.featureId}@${f.featureVersion}`), action: impact.action }, componentId: 'D06-11' });
      this.events.publish('vex.recorded', body.vulnId, { ...impact }, { componentId: 'D06-11', correlationId: actor.correlationId });
      return { statement: body, impact };
    });
  }

  vex() {
    return this.db.all<{ doc: string; at: string }>('SELECT doc, at FROM vex ORDER BY id').map((r) => ({ ...JSON.parse(r.doc), at: r.at }));
  }
}

@Controller('api')
export class SbomController {
  constructor(private readonly sbom: SbomService) {}

  @Get('sbom')
  list(@Query('featureId') featureId?: string) {
    return { items: this.sbom.list(featureId) };
  }

  @Get('sbom/:serial')
  get(@Param('serial') serial: string) {
    return this.sbom.get(serial);
  }

  @Get('vex')
  vex() {
    return { items: this.sbom.vex() };
  }

  @Post('vex')
  @Roles('SECURITY_OFFICER', 'SAFETY_OFFICER')
  @AuditAction('VEX_RECORD')
  record(@CurrentActor() actor: Actor, @Body(new ZodPipe(VexStatement)) body: VexStatement) {
    return this.sbom.recordVex(actor, body);
  }
}
