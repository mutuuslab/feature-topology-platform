// 26580 변이 프로필 데모 시드(20-60 §11) — 기준 행에 연결된 데모 Feature(최신 Version)마다 대표 행 제안값을 SEED로 한 번 넣는다.
// 결정적(같은 데이터 → 같은 결과), 고객 설치(FF_SEED=none)는 넣지 않는다. 시드가 없어도 카탈로그·bill-of-features는 대표 행 제안값으로 그려진다.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { bundleRepFinder, latestByFeature, proposeVariability, type PleRef } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { seedOf } from '../../../kernel/runtime-config';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo } from '../repos';
import { PleRepo } from './ple.repo';

export const PLE_SEED_META = 'seed-ple';
export const PLE_SEED_ACTOR = 'system:ple-seed';

@Injectable()
export class PleSeed implements OnApplicationBootstrap {
  private readonly log = new Logger('PleSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: PleRepo,
    private readonly refdb: RefdbRepository,
    private readonly features: FeatureRepo,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (seedOf(process.env) === 'none') return;
    const n = this.run();
    if (n) this.log.log(`26580 변이 프로필 시드 ${n}건`);
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
}
