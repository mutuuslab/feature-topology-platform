// Git 호출 위치는 개발자/CI가 가져온 스냅샷이다. 원격 저장소 검증이나 차량 적용의 증명으로 취급하지 않는다.
import { Body, Controller, Get, Inject, Injectable, OnApplicationBootstrap, Post, Query } from '@nestjs/common';
import { canonicalJson, FeatureFlagsQuery, FlagSourceImport, FlagSourceManifest, flagSourceUrl, type FeatureFlagRow, type FlagSourceLocation, type Policy, type Publication } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { isProduction } from '../../../kernel/runtime-config';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo } from '../repos';

const COMPONENT = 'D01-06';
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'demo', 'flag-sources.json');
const hash = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const captureContent = ({ scannedAt: _scannedAt, ...content }: FlagSourceManifest) => canonicalJson(content);
const key = (featureId: string, version: string, flagKey: string) => `${featureId}@${version}:${flagKey}`;
const policyKey = (policy: Policy) => `${key(policy.featureId, policy.featureVersion, policy.flagKey)}:${policy.policyId}@${policy.revision}`;
interface StoredManifest {
  id: number;
  manifest_id: string;
  repository: string;
  commit_id: string;
  scanned_at: string;
  content_hash: string;
  imported_at: string;
  imported_by: string;
  provenance: 'CI_IMPORT' | 'DEMO';
  doc: string;
}

@Injectable()
@PlatformComponent(COMPONENT)
export class FlagSourceService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (process.env.FF_SEED === 'none' || isProduction() || !existsSync(FIXTURE)) return;
    this.append({ id: 'system:flag-sources-demo', role: 'SYSTEM', correlationId: 'demo-flag-sources' }, JSON.parse(readFileSync(FIXTURE, 'utf8')), 'DEMO');
  }

  /** HTTP 가드 외에 서비스에서도 쓰기 역할을 확인한다. provenance는 요청 본문으로 정할 수 없다. */
  import(actor: Actor, input: unknown): FlagSourceImport {
    if (actor.role !== 'IMPLEMENTER') throw new DomainError('FORBIDDEN', '소스 사용처 가져오기는 구현 담당 역할만 수행할 수 있습니다.');
    return this.append(actor, input, 'CI_IMPORT');
  }

  private parse(input: unknown): FlagSourceManifest {
    const parsed = FlagSourceManifest.safeParse(input);
    if (!parsed.success) throw new DomainError('VALIDATION', '소스 스냅샷의 입력값을 확인하세요.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return parsed.data;
  }

  private read(row: StoredManifest, latest: boolean): FlagSourceImport {
    try {
      const manifest = FlagSourceManifest.parse(JSON.parse(row.doc));
      if (manifest.repository !== row.repository || manifest.commit !== row.commit_id || manifest.scannedAt !== row.scanned_at || hash(canonicalJson(manifest)) !== row.content_hash) throw new Error('content mismatch');
      return FlagSourceImport.parse({ manifestId: row.manifest_id, manifest, contentHash: row.content_hash, importedAt: row.imported_at, importedBy: row.imported_by, provenance: row.provenance, latest });
    } catch {
      throw new DomainError('INTERNAL', '저장된 소스 스냅샷의 무결성을 확인하지 못했습니다. 관리자에게 기록 점검을 요청하세요.');
    }
  }

  private append(actor: Actor, input: unknown, provenance: 'CI_IMPORT' | 'DEMO'): FlagSourceImport {
    const manifest = this.parse(input);
    const doc = canonicalJson(manifest);
    const contentHash = hash(doc);
    return this.db.tx(() => {
      const prior = this.db.get<StoredManifest>('SELECT * FROM flag_source_manifest WHERE repository = ? AND commit_id = ?', manifest.repository, manifest.commit);
      if (prior) {
        const original = this.read(prior, false);
        // 같은 커밋 재스캔은 시각만 달라질 수 있다. 첫 기록의 시각·원문·해시·작성자를 그대로 돌려준다.
        if (captureContent(original.manifest) !== captureContent(manifest)) throw new DomainError('CONFLICT', '같은 저장소·커밋의 스냅샷 내용이 기존 기록과 다릅니다. 기존 기록을 덮어쓸 수 없습니다.');
        return this.list().find((r) => r.manifestId === prior.manifest_id)!;
      }
      const n = (this.db.get<{ n: number }>('SELECT max(id) AS n FROM flag_source_manifest')?.n ?? 0) + 1;
      const manifestId = `FSRC-${String(n).padStart(6, '0')}`;
      const importedAt = this.clock.iso();
      this.db.run('INSERT INTO flag_source_manifest (manifest_id, repository, commit_id, scanned_at, content_hash, imported_at, imported_by, provenance, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', manifestId, manifest.repository, manifest.commit, manifest.scannedAt, contentHash, importedAt, actor.id, provenance, doc);
      const detail = { manifestId, repository: manifest.repository, commit: manifest.commit, contentHash, provenance, filesScanned: manifest.filesScanned, usages: manifest.usages.length, unresolvedCalls: manifest.unresolvedCalls };
      this.audit.record(actor, 'FLAG_SOURCE_IMPORT', manifestId, { after: detail, componentId: COMPONENT });
      this.events.publish('flag.sources.imported', manifestId, detail, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.list().find((r) => r.manifestId === manifestId)!;
    });
  }

  /** 스캔 시각이 최신인 스냅샷만 현재 연결에 쓴다. 뒤늦게 가져온 옛 스캔은 이력으로 남는다. */
  list(): FlagSourceImport[] {
    const seen = new Set<string>();
    return this.db.all<StoredManifest>('SELECT * FROM flag_source_manifest ORDER BY scanned_at DESC, id DESC').map((row) => {
      const latest = !seen.has(row.repository);
      seen.add(row.repository);
      return this.read(row, latest);
    });
  }

  flags(query: FeatureFlagsQuery = {}): FeatureFlagRow[] {
    const parsedQuery = FeatureFlagsQuery.safeParse(query);
    if (!parsedQuery.success) throw new DomainError('VALIDATION', 'Feature ID와 버전 조회 조건을 확인하세요.');
    const usages = new Map<string, FlagSourceLocation[]>();
    const seenUsages = new Set<string>();
    for (const imported of this.list().filter((r) => r.latest)) {
      const { manifest } = imported;
      for (const usage of manifest.usages) {
        const { flagKey, ...location } = usage;
        const source: FlagSourceLocation = { ...location, repository: manifest.repository, provider: manifest.provider, commit: manifest.commit, url: flagSourceUrl({ provider: manifest.provider, repository: manifest.repository, commit: manifest.commit, path: usage.path, line: usage.line }), importedAt: imported.importedAt, importedBy: imported.importedBy, provenance: imported.provenance };
        const current = usages.get(flagKey) ?? [];
        const identity = canonicalJson({ flagKey, ...source });
        if (!seenUsages.has(identity)) current.push(source);
        seenUsages.add(identity);
        usages.set(flagKey, current);
      }
    }
    // 같은 Flag·Feature Version의 정책을 새로 만들었으면 마지막 정책을 보여 준다.
    const selected = new Map<string, Policy>();
    for (const policy of this.policies.all()) selected.set(key(policy.featureId, policy.featureVersion, policy.flagKey), policy);
    const knownFlags = new Set([...selected.values()].map((p) => p.flagKey));
    const features = new Map(this.features.all().map((f) => [`${f.featureId}@${f.version}`, f]));
    const publications = new Map<string, Publication>();
    for (const row of this.db.all<{ doc: string }>("SELECT doc FROM publication WHERE kind = 'POLICY' ORDER BY created_at DESC, publication_id DESC")) {
      const p = JSON.parse(row.doc) as Publication;
      const embedded = p.payload.policy;
      if (!embedded || p.kind !== 'POLICY' || p.payload.featureId !== embedded.featureId || p.payload.featureVersion !== embedded.featureVersion || p.payload.flagKey !== embedded.flagKey) continue;
      const scope = policyKey(embedded);
      if (!publications.has(scope)) publications.set(scope, p);
    }
    const rows: FeatureFlagRow[] = [];
    for (const policy of selected.values()) {
      if ((parsedQuery.data.featureId && policy.featureId !== parsedQuery.data.featureId) || (parsedQuery.data.version && policy.featureVersion !== parsedQuery.data.version)) continue;
      const publication = publications.get(policyKey(policy));
      rows.push({
        flagKey: policy.flagKey, featureId: policy.featureId, version: policy.featureVersion,
        featureName: features.get(`${policy.featureId}@${policy.featureVersion}`)?.name ?? null,
        policy: { policyId: policy.policyId, status: policy.status, revision: policy.revision, controlPoint: policy.controlPoint },
        sources: usages.get(policy.flagKey) ?? [],
        publication: publication ? { publicationId: publication.publicationId, status: publication.status, confirmed: publication.confirmed, denominator: publication.denominator } : null,
      });
    }
    if (!parsedQuery.data.featureId && !parsedQuery.data.version) for (const [flagKey, sources] of usages) {
      if (!knownFlags.has(flagKey)) rows.push({ flagKey, featureId: null, version: null, featureName: null, policy: null, sources, publication: null });
    }
    return rows.sort((a, b) => {
      const left = `${a.flagKey}:${a.featureId ?? ''}:${a.version ?? ''}`;
      const right = `${b.flagKey}:${b.featureId ?? ''}:${b.version ?? ''}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
}

@Controller('api')
export class FlagSourceController {
  constructor(private readonly sources: FlagSourceService) {}

  @Get('feature-flags')
  flags(@Query(new ZodPipe(FeatureFlagsQuery)) query: FeatureFlagsQuery) {
    return this.sources.flags(query);
  }

  @Get('flag-sources')
  list() {
    return this.sources.list();
  }

  @Post('flag-sources')
  @Roles('IMPLEMENTER')
  @AuditAction('FLAG_SOURCE_IMPORT')
  import(@CurrentActor() actor: Actor, @Body(new ZodPipe(FlagSourceManifest)) body: FlagSourceManifest) {
    return this.sources.import(actor, body);
  }
}
