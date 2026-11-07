// ADS 발행 검사 (D02-01 → 정책 배포 D01-06·보안 배포 D06-08) — 규칙은 contracts rules/ads-publish.ts. 상태 없는 DB 읽기라 전달 모듈(DeliveryModule)에서 만든다.
//  · 정책 컴파일(ADS-BE09): 배포 설정이 묶인 Flag는 승인 ODD 프로파일의 승인 상한 안이어야 배포한다(모든 Feature).
//  · 발행 후보(ADS-BE10·BE16): Feature 적용 범위 차량을 승인 구성 조합·시장 기준선으로 거른다. 강제(게시 대상에서 제외)는 ADS Feature(분류 adsFeature)만 —
//    ADAS 등 다른 Feature는 대상을 바꾸지 않고 제외될 차량·사유를 build 기록과 미리보기에 남긴다(F2+ 전체 강제는 사용자 결정 대기, 기존 배포 흐름 일괄 차단 방지).
//  · 빌드 기록(ADS-BE11): 서명 payload 밖에 결정적 digest(발행 메타 제외)·컴파일러 판·ODD 프로파일 참조·키 epoch.
import { Inject, Injectable } from '@nestjs/common';
import {
  buildDigestInput,
  classifyVehicleConfig,
  oddCompileBlockers,
  POLICY_COMPILER_VERSION,
  policySpecOf,
  publishCandidates,
  reactivationCandidate,
  type AdsClassification,
  type ConfigSet,
  type DeploySetting,
  type MarketBaseline,
  type OddProfile,
  type Policy,
  type Publication,
  type PublishBlocker,
  type PublishCandidates,
  type VehicleConfigReport,
} from '@ff/contracts';
import { createHash } from 'node:crypto';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

const parse = <T>(r: { doc: string } | undefined): T | null => (r ? (JSON.parse(r.doc) as T) : null);

export interface CandidateView extends PublishCandidates {
  /** 강제 여부 — ADS Feature만 게시 대상에서 뺀다 */
  enforced: boolean;
  /** 강제하지 않는 Feature의 발행 거부 사유(참고) */
  warnings: PublishBlocker[];
}

@Injectable()
export class AdsPublishGate {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
  ) {}

  sets(featureId: string, version: string): ConfigSet[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_config_set WHERE feature_id = ? AND feature_version = ? ORDER BY set_id', featureId, version).map((r) => JSON.parse(r.doc) as ConfigSet);
  }
  report(vin: string): VehicleConfigReport | null {
    return parse<VehicleConfigReport>(this.db.get<{ doc: string }>('SELECT doc FROM ads_vehicle_config WHERE vin = ?', vin));
  }
  classification(featureId: string, version: string): AdsClassification | null {
    return parse<AdsClassification>(this.db.get<{ doc: string }>('SELECT doc FROM ads_classification WHERE feature_id = ? AND version = ?', featureId, version));
  }
  baselines(featureId: string, version: string): MarketBaseline[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_market_baseline WHERE feature_id = ? AND version = ? ORDER BY market', featureId, version).map((r) => JSON.parse(r.doc) as MarketBaseline);
  }
  /** Feature Version의 지금 승인 상한 — 가장 높은 승인 버전 */
  approvedProfile(featureId: string, version: string): OddProfile | null {
    return parse<OddProfile>(this.db.get<{ doc: string }>("SELECT doc FROM ads_odd_profile WHERE feature_id = ? AND feature_version = ? AND status = 'APPROVED' ORDER BY version DESC LIMIT 1", featureId, version));
  }
  settings(featureId: string, version: string): DeploySetting[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_deploy_setting WHERE feature_id = ? AND feature_version = ? ORDER BY setting_id', featureId, version).map((r) => JSON.parse(r.doc) as DeploySetting);
  }
  private safety(featureId: string, version: string): { fClass?: string; adsFeature?: boolean } | null {
    return parse(this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version));
  }
  /** ADS Feature — 분류(확정 여부와 무관하게 입력값) 또는 안전 분류의 ADS 여부 */
  isAdsFeature(featureId: string, version: string): boolean {
    return this.classification(featureId, version)?.adsFeature === true || this.safety(featureId, version)?.adsFeature === true;
  }

  /** 정책 컴파일 검사 — 이 Flag의 배포 설정 ↔ 승인 상한 */
  compileBlockers(p: Pick<Policy, 'featureId' | 'featureVersion' | 'flagKey'>): PublishBlocker[] {
    return oddCompileBlockers({ flagKey: p.flagKey, settings: this.settings(p.featureId, p.featureVersion), profile: this.approvedProfile(p.featureId, p.featureVersion) });
  }

  /** 발행 후보 — 적용 범위 차량(vins)을 승인 조합·시장 기준선으로 거른다 */
  candidates(featureId: string, version: string, vins: string[]): CandidateView {
    const enforced = this.isAdsFeature(featureId, version);
    const now = this.clock.now().getTime();
    const r = publishCandidates(
      { adsScope: true, fClass: this.safety(featureId, version)?.fClass ?? null, sets: this.sets(featureId, version), baselines: this.baselines(featureId, version), approvedOddProfileId: this.approvedProfile(featureId, version)?.profileId ?? null, classification: this.classification(featureId, version), now },
      vins.map((vin) => ({ vin, country: this.fleet.vehicle(vin)?.country ?? '', report: this.report(vin) })),
    );
    if (enforced) return { ...r, enforced, warnings: [] };
    return { targets: vins, excluded: r.excluded, unverifiedCombo: r.unverifiedCombo, blockers: [], enforced, warnings: r.blockers };
  }

  /** 정책 배포를 막는 사유 — 컴파일 검사(모든 Feature) + 발행 거부(ADS Feature) */
  deployBlockers(p: Policy, vins: string[]): PublishBlocker[] {
    return [...this.compileBlockers(p), ...this.candidates(p.featureId, p.featureVersion, vins).blockers];
  }

  /** 지금 차량 키 epoch(HSM) — 복구 후보 메타데이터 재검증 기준 */
  keyEpoch(): number {
    return this.db.get<{ e: number | null }>("SELECT max(epoch) AS e FROM hsm_secret WHERE name = 'vehicle_root'")?.e ?? 1;
  }

  /** 게시본 build 기록 — 같은 승인 입력이면 같은 digest(발행 메타·대상 제외) */
  build(p: Pick<Publication['payload'], 'kind' | 'featureId' | 'featureVersion' | 'flagKey' | 'policy' | 'kill' | 'desired'>, candidates: CandidateView | null): NonNullable<Publication['build']> {
    const oddProfileRef = this.approvedProfile(p.featureId, p.featureVersion)?.profileId ?? null;
    const input = buildDigestInput({ kind: p.kind, featureId: p.featureId, featureVersion: p.featureVersion, flagKey: p.flagKey, spec: p.policy ? policySpecOf(p.policy as unknown as Record<string, unknown>) : null, contentHash: p.policy?.contentHash ?? null, desired: p.desired, kill: p.kill, oddProfileRef });
    return {
      bundleDigest: `sha256:${createHash('sha256').update(input).digest('hex')}`,
      compilerVersion: POLICY_COMPILER_VERSION,
      oddProfileRef,
      keyEpoch: this.keyEpoch(),
      candidates: candidates ? { enforced: candidates.enforced, excluded: candidates.excluded, unverifiedCombo: candidates.unverifiedCombo, blockers: [...candidates.blockers, ...candidates.warnings] } : null,
    };
  }

  /**
   * 차량 증명의 형상 전체 — 보고 형상을 저장하고(형상 대조 입력), 이 차량을 적용 범위로 갖는 Feature의 승인 조합과 대조한다.
   * 부분 복구·불일치·보안 최소 미달은 재활성화 후보가 아니다(TC17).
   */
  attest(vin: string, cfg: Omit<VehicleConfigReport, 'vin' | 'reportedAt'>, observedAt: string) {
    const report: VehicleConfigReport = { vin, reportedAt: observedAt, ...cfg };
    const has = this.db.get('SELECT 1 FROM ads_vehicle_config WHERE vin = ?', vin);
    if (has) this.db.run('UPDATE ads_vehicle_config SET reported_at = ?, doc = ? WHERE vin = ?', observedAt, JSON.stringify(report), vin);
    else this.db.run('INSERT INTO ads_vehicle_config (vin, reported_at, doc) VALUES (?, ?, ?)', vin, observedAt, JSON.stringify(report));
    const v = this.fleet.vehicle(vin);
    const now = this.clock.now().getTime();
    const byFeature = new Map<string, ConfigSet[]>();
    for (const s of this.db.all<{ doc: string }>('SELECT doc FROM ads_config_set ORDER BY set_id').map((r) => JSON.parse(r.doc) as ConfigSet)) {
      const f = this.features.get(s.featureId, s.featureVersion);
      if (!v || !f || f.country !== v.country || f.vehicleModel !== v.vehicleModel || f.trim !== v.trim) continue;
      const k = `${s.featureId}@${s.featureVersion}`;
      byFeature.set(k, [...(byFeature.get(k) ?? []), s]);
    }
    return [...byFeature.values()].map((sets) => {
      const all = sets.map((s) => ({ s, v: classifyVehicleConfig(s, report, now) }));
      const best = all.find((x) => x.v.cls === 'MATCH') ?? all[0];
      return { featureId: best.s.featureId, featureVersion: best.s.featureVersion, setId: best.s.setId, cls: best.v.cls, code: best.v.code, reasons: best.v.reasons, reactivation: reactivationCandidate(best.v) };
    });
  }
}
