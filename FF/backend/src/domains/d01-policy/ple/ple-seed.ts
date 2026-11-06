// 26580 변이 프로필 데모 시드(20-60 §11) — 기준 행에 연결된 데모 Feature(최신 Version)마다 대표 행 제안값을 SEED로 한 번 넣는다.
// 결정적(같은 데이터 → 같은 결과), 고객 설치(FF_SEED=none)는 넣지 않는다. 시드가 없어도 카탈로그·bill-of-features는 대표 행 제안값으로 그려진다.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { autofillDecisions, autofillFromRef, bundleRepFinder, latestByFeature, proposeVariability, type PleRef } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { seedOf } from '../../../kernel/runtime-config';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo, ProductRepo } from '../repos';
import { PleRepo } from './ple.repo';

export const PLE_SEED_META = 'seed-ple';
/** 정의 승인 전 데모 등록의 자동 채움 이력(등록 현황·상세 이력이 비지 않게) — 변이 프로필 시드와 따로 한 번 */
export const PLE_SEED_AUTOFILL_META = 'seed-ple-autofill';
export const PLE_SEED_ACTOR = 'system:ple-seed';

@Injectable()
export class PleSeed implements OnApplicationBootstrap {
  private readonly log = new Logger('PleSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: PleRepo,
    private readonly refdb: RefdbRepository,
    private readonly features: FeatureRepo,
    private readonly products: ProductRepo,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (seedOf(process.env) === 'none') return;
    const n = this.run();
    if (n) this.log.log(`26580 변이 프로필 시드 ${n}건`);
    const h = this.runAutofill();
    if (h) this.log.log(`26580 자동 채움 이력 시드 ${h}건`);
  }

  /** 넣은 건수 — 이미 넣었으면(meta) 0 */
  run(): number {
    if (this.db.get("SELECT 1 FROM meta WHERE key = ?", PLE_SEED_META)) return 0;
    const refs = new Map(this.refdb.listRefs().map((r) => [r.refId, r as PleRef]));
    if (!refs.size) return 0;
    const repOf = bundleRepFinder(refs);
    const at = this.clock.iso();
    let n = 0;
    this.db.tx(() => {
      for (const f of latestByFeature(this.features.all())) {
        const p = f.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;
        const ref = p ? refs.get(p) : undefined;
        if (!ref || this.repo.variability(f.featureId, f.version)) continue;
        this.repo.putVariability(f.featureId, f.version, proposeVariability(ref, { controlPoints: f.controlPoints, swIds: f.swIds, bundleRepOf: repOf }), 'SEED', PLE_SEED_ACTOR, at);
        n++;
      }
      this.db.run("INSERT INTO meta (key, value) VALUES (?, ?)", PLE_SEED_META, String(n));
    });
    return n;
  }
  /**
   * 정의 승인 전(PROPOSED) 데모 등록마다 — 등록할 때 서버가 남기는 것과 같은 칸별 결정(등록 전 Feature 목록 기준, 등록자·등록 시각).
   * 이미 이력이 있는 Version은 건너뛴다. 넣은 Version 수 — 이미 넣었으면(meta) 0
   */
  runAutofill(): number {
    if (this.db.get('SELECT 1 FROM meta WHERE key = ?', PLE_SEED_AUTOFILL_META)) return 0;
    const refs = new Map(this.refdb.listRefs().map((r) => [r.refId, r as PleRef]));
    if (!refs.size) return 0;
    const all = this.features.all();
    const scopes = this.products.all().map((p) => ({ country: p.country, vehicleModel: p.vehicleModel, trim: p.trim }));
    let n = 0;
    this.db.tx(() => {
      for (const f of latestByFeature(all).filter((x) => x.lifecycle === 'PROPOSED')) {
        const p = f.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;
        const ref = p ? refs.get(p) : undefined;
        if (!ref || this.repo.history(f.featureId, f.version).length) continue;
        // 시드 Feature는 등록자 기록이 없다 — 시드 계정·시드 시각으로 남긴다(화면 '시스템(자동)')
        const meta = this.features.meta(f.featureId, f.version);
        const by = meta.createdBy ?? PLE_SEED_ACTOR;
        const at = meta.createdAt ?? this.clock.iso();
        const before = all.filter((x) => x.featureId !== f.featureId);
        const result = autofillFromRef(ref, { features: before, refsById: refs, scopes, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, name: f.name });
        const rows = autofillDecisions(result, { ...f, refRegulations: f.refRegulations ?? [], variability: this.repo.variability(f.featureId, f.version)?.variability ?? null });
        this.repo.addDecisions(f.featureId, f.version, rows, by, at);
        n++;
      }
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', PLE_SEED_AUTOFILL_META, String(n));
    });
    return n;
  }
}
