// JIRA Epic = FF Feature(80-50 §4.1, D-ALM-1) — Feature 하나에 Epic 하나. Epic 상태는 작업 중 버전 상태(D10 A-1 기본값), 버전은 Epic 필드.
// 연결 표(ext_link)는 버전 단위라 Feature Epic을 그 Feature의 모든 버전에 연결한다(추적·목록 화면이 그대로 읽는다).
// 옛 "버전마다 Epic"은 전체 대사가 최신 버전 것 하나로 합친다(나머지는 supersededBy 표시 + 'FF 이전 Epic').
import { Injectable } from '@nestjs/common';
import { epicDesired, epicVersions, type EpicDesired, type ExtLink } from '@ff/contracts';
import { FeatureRepo, GateRepo } from '../../../d01-policy/repos';
import { ExtSyncRepo } from './ext-sync.repo';

const fid = (featureId: string, version: string) => `${featureId}@${version}`;

/** 다른 기능(산출물 작성률 등)이 Epic 읽기 전용 칸에 값을 더한다 — 순환 의존 없이 */
export type EpicExtra = (featureId: string, version: string) => { workProducts?: string | null };

@Injectable()
export class FeatureEpics {
  private extras: EpicExtra[] = [];
  constructor(
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly repo: ExtSyncRepo,
  ) {}

  addExtra(fn: EpicExtra) {
    this.extras.push(fn);
  }

  /** FF 링크 칸 — FF_PUBLIC_URL이 있으면 절대 주소, live인데 없으면 비움, 모의는 같은 화면 안 경로 */
  link(featureId: string, version: string): string | null {
    const base = (process.env.FF_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
    if (base) return `${base}/features/${featureId}/${version}`;
    return process.env.IF_MODE_14 === 'live' ? null : `/features/${featureId}/${version}`;
  }

  /** FF가 Epic에 쓸 값 — 작업 중 버전 기준 */
  desired(featureId: string): EpicDesired | null {
    const versions = this.features.versions(featureId);
    const { epic } = epicVersions(versions);
    if (!epic) return null;
    const latest = this.gates.latest(featureId, epic.version);
    const gates = Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r!.status]));
    const extra = this.extras.reduce<{ workProducts?: string | null }>((acc, fn) => ({ ...acc, ...fn(featureId, epic.version) }), {});
    return epicDesired(versions, { gates, workProducts: extra.workProducts ?? null, link: this.link(featureId, epic.version) });
  }

  /** 이 Feature에 연결된 Epic들(옛 버전별 Epic 포함, 버전 높은 순) */
  linked(featureId: string): ExtLink[] {
    const out = new Map<string, ExtLink>();
    for (const v of [...this.features.versions(featureId)].reverse())
      for (const l of this.repo.linksOf('FEATURE', fid(featureId, v.version), 'JIRA')) if (l.kind === 'EPIC' && !out.has(l.key)) out.set(l.key, l);
    return [...out.values()];
  }

  /** Feature Epic 키 — 합쳐진(이전) Epic은 빼고, Epic 버전에 연결된 것 → 가장 높은 버전에 연결된 것 */
  key(featureId: string): string | null {
    const live = this.linked(featureId).filter((l) => !l.extra.supersededBy);
    const v = epicVersions(this.features.versions(featureId)).epic?.version;
    return (live.find((l) => l.entityId === fid(featureId, v ?? '')) ?? live[0])?.key ?? null;
  }

  /** Epic을 이 Feature의 모든 버전에 연결(이미 있으면 그대로) */
  linkAll(key: string, featureId: string, by: string) {
    for (const v of this.features.versions(featureId)) this.repo.link('JIRA', key, 'FEATURE', fid(featureId, v.version), by);
  }

  /** Epic 키 → Feature ID */
  featureOf(key: string): string | null {
    const e = this.repo.entitiesOf('JIRA', key, 'FEATURE')[0];
    return e ? e.entityId.split('@')[0] : null;
  }
}
