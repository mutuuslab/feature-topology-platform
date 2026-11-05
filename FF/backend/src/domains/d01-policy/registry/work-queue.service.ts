// 검토함 대기열(D01-01, 담당자 E2E W2 — P2-3·P1-4·P3-6) — 정의 승인·Release Sign-off·출시 가능·Gate 판정·안전 분류 확정을 기다리는
// Feature 최신 Version을 모은다. 들어가는 조건은 contracts(rules/work-queue)에 있고, 내 차례·부서·급한 순서는 화면이 정한다.
// 요청 시각(since)은 조건이 갖춰진 마지막 Gate 판정 시각, 없으면 Version을 만든 시각 — 결재함 '요청 시각' 빈 칸을 채운다.
import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { compareVersion, definitionReady, GATE_META, pendingGates, RECENT_FEATURES, signoffReady, type GateId, type WorkQueueFeature, type WorkQueues } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { FeatureRepo } from '../repos';
import { ReleaseSignoffService } from './release-signoff.service';
import { SafetyProfileService } from './safety-profile.service';
import { AnalysisEvidenceService } from '../topology/analysis-evidence.service';

/** 판정 시각은 표기가 섞여 있다(Z·+09:00) — 글자 순서가 아니라 시각으로 고른다 */
const byTime = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b));
const latestOf = (xs: (string | null | undefined)[]) => byTime(xs).at(-1) ?? null;
const earliestOf = (xs: (string | null | undefined)[]) => byTime(xs)[0] ?? null;

/** 대기열에서 빼는 Lifecycle — 끝난 Feature */
const CLOSED = new Set(['DEPRECATED', 'RETIRED']);

@Injectable()
@PlatformComponent('D01-01')
export class WorkQueueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly signoffs: ReleaseSignoffService,
    private readonly profiles: SafetyProfileService,
    private readonly analysis: AnalysisEvidenceService,
  ) {}

  queues(): WorkQueues {
    const all = this.features.all();
    const latest = new Map<string, (typeof all)[number]>();
    for (const f of all) {
      const cur = latest.get(f.featureId);
      if (!cur || compareVersion(f.version, cur.version) > 0) latest.set(f.featureId, f);
    }
    // Gate별 최신 상태·판정 시각 — 한 번에(버전마다 묻지 않는다)
    const gates = new Map<string, Record<string, { status: string; at: string | null }>>();
    for (const r of this.db.all<{ k: string; gate: string; status: string; at: string | null }>(
      "SELECT feature_id || '@' || feature_version AS k, gate, status, judged_at AS at FROM gate_record ORDER BY gate, judged_at, gate_record_id",
    )) {
      const m = gates.get(r.k) ?? {};
      m[r.gate] = { status: r.status, at: r.at };
      gates.set(r.k, m);
    }
    const meta = new Map(
      this.db.all<{ k: string; by: string | null; at: string | null }>("SELECT feature_id || '@' || version AS k, created_by AS by, created_at AS at FROM feature_version").map((r) => [r.k, r]),
    );
    const homologated = this.analysis.validHomologations();
    const out: WorkQueues = { definitions: [], signoffs: [], releasable: [], gates: [], classifications: [], homologations: [], recent: [] };
    for (const f of latest.values()) {
      if (CLOSED.has(f.lifecycle)) continue;
      const key = `${f.featureId}@${f.version}`;
      const g = gates.get(key) ?? {};
      const status = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.status]));
      const m = meta.get(key);
      const at = (ids: readonly string[]) => latestOf(ids.map((id) => g[id]?.at)) ?? m?.at ?? null;
      const base = (since: string | null): WorkQueueFeature => ({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, createdBy: m?.by ?? null, since });
      if (f.lifecycle !== 'RELEASED' && !homologated.has(key)) out.homologations.push(base(at(['G1', 'G2', 'G3'])));
      if (definitionReady({ lifecycle: f.lifecycle, gates: status })) out.definitions.push(base(at(['G1', 'G2', 'G3'])));
      if (f.lifecycle === 'VERIFIED') {
        const v = this.signoffs.view(f.featureId, f.version);
        if (signoffReady({ lifecycle: f.lifecycle, gates: status }, v.valid)) out.signoffs.push({ ...base(at(['G8', 'G9'])), stale: v.stale && !!v.signoff });
        else if (v.valid && v.signoff) out.releasable.push({ ...base(v.signoff.signedAt), signedBy: v.signoff.signedBy, signedAt: v.signoff.signedAt });
      }
      // 지금 단계 Gate 판정 대기 — 앞 Gate를 판정한 시각(없으면 만든 시각)부터 기다린 것으로 본다
      for (const gate of pendingGates(f.lifecycle, status)) {
        const before = (Object.keys(GATE_META) as GateId[]).filter((x) => x < gate);
        out.gates.push({ ...base(g[gate]?.at ?? at(before)), gate, status: g[gate]?.status ?? null });
      }
    }
    // 안전 분류 확정 대기 — 최신 Version의 DRAFT 분류만(지난 Version 초안은 확정할 일이 아니다)
    for (const p of this.profiles.list()) {
      const f = latest.get(p.featureId);
      if (!f || f.version !== p.version || CLOSED.has(f.lifecycle) || p.status !== 'DRAFT') continue;
      const key = `${f.featureId}@${f.version}`;
      const g = gates.get(key) ?? {};
      const since = earliestOf(Object.values(g).map((x) => x.at)) ?? meta.get(key)?.at ?? null;
      out.classifications.push({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, createdBy: meta.get(key)?.by ?? null, since, fClass: p.fClass });
    }
    // 최근 Feature — 만든 시각이 늦은 순(시드는 시각이 없어 ID 큰 순으로 뒤에)
    out.recent = [...latest.values()]
      .filter((f) => !CLOSED.has(f.lifecycle))
      .map((f) => {
        const m = meta.get(`${f.featureId}@${f.version}`);
        return { featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, createdBy: m?.by ?? null, since: m?.at ?? null };
      })
      .sort((a, b) => (b.since ?? '').localeCompare(a.since ?? '') || b.featureId.localeCompare(a.featureId))
      .slice(0, RECENT_FEATURES);
    return out;
  }
}

@Controller('api/work-queues')
export class WorkQueueController {
  constructor(private readonly q: WorkQueueService) {}

  @Get()
  list() {
    return this.q.queues();
  }
}
