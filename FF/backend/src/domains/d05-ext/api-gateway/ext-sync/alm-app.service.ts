// JIRA 안의 FF 앱(80-50 §4.7, D-ALM-8) — Epic 생성·편집 패널 "FF Feature"와 보기 패널 "FF 현황"이 부르는 API.
//   앱 자격: OAuth2 client credentials(FF_ALM_APP_CLIENT_ID·FF_ALM_APP_CLIENT_SECRET, 운영 모드가 아니면 공개 모의 값) → Bearer 토큰(1시간, 메모리).
//   요청마다 JIRA 사용자(X-FF-Jira-User)를 ext-identities로 매핑해 그 사람의 역할로 읽는다(매핑 없으면 403). 쓰기 API는 없다 —
//   앱은 Epic 사용자 필드를 쓰고, FF는 webhook으로 받아 같은 가드(featureFromEpic·필드 주인 규칙)를 탄다.
//   실서버 형태(Forge·Connect)는 정해지지 않아 모의 JIRA의 앱 흉내 패널(/_mock/app/epic-form)이 이 API를 쓴다(D-ALM-17, A-3).
import { Inject, Injectable } from '@nestjs/common';
import { epicVersions, JIRA_EPIC_STATUS, WORK_PRODUCT, wpSummaryText, type Role } from '@ff/contracts';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { isProduction } from '../../../../kernel/runtime-config';
import { RefdbReadService } from '../../../d01-policy/refdb/refdb-read.service';
import { FeatureRepo } from '../../../d01-policy/repos';
import { AlmWorkProductsService } from './alm-workproducts.service';
import { ExtSyncService } from './ext-sync.service';
import { FeatureEpics } from './feature-epic';

const TTL_S = 3600;
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

@Injectable()
export class AlmAppService {
  private readonly tokens = new Map<string, number>();
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly sync: ExtSyncService,
    private readonly read: RefdbReadService,
    private readonly features: FeatureRepo,
    private readonly epics: FeatureEpics,
    private readonly wp: AlmWorkProductsService,
  ) {}

  private client() {
    const id = process.env.FF_ALM_APP_CLIENT_ID || 'ff-jira-app';
    const secret = process.env.FF_ALM_APP_CLIENT_SECRET || (isProduction() ? '' : 'ff-mock-app-secret');
    return { id, secret };
  }

  token(body: { grant_type?: unknown; client_id?: unknown; client_secret?: unknown }) {
    const c = this.client();
    if (body.grant_type !== 'client_credentials' || !c.secret || typeof body.client_id !== 'string' || typeof body.client_secret !== 'string' || !same(body.client_id, c.id) || !same(body.client_secret, c.secret))
      throw new DomainError('UNAUTHENTICATED', 'JIRA 앱 자격이 맞지 않습니다.');
    const now = this.clock.now().getTime();
    for (const [t, exp] of this.tokens) if (exp <= now) this.tokens.delete(t);
    const t = randomBytes(32).toString('base64url');
    this.tokens.set(t, now + TTL_S * 1000);
    return { access_token: t, token_type: 'Bearer', expires_in: TTL_S };
  }

  /** 앱 토큰 + JIRA 사용자 → 그 사람의 첫 역할(읽기 범위) */
  who(headers: Record<string, string | string[] | undefined>): { role: Role; user: string } {
    const auth = String(headers.authorization ?? '');
    const t = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const exp = t ? this.tokens.get(t) : undefined;
    if (!exp || exp <= this.clock.now().getTime()) throw new DomainError('UNAUTHENTICATED', 'JIRA 앱 토큰이 없거나 만료되었습니다.');
    const user = String(headers['x-ff-jira-user'] ?? '').trim();
    const id = user ? this.sync.identity('JIRA', user) : null;
    if (!id) throw new DomainError('FORBIDDEN', `JIRA 계정 '${user}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`);
    return { role: id.roles[0] as Role, user };
  }

  refs(role: Role, q: Record<string, unknown>) {
    return this.read.list(q as never, role);
  }

  /** 판매국·차종·트림(사용 중) — 패널 선택지 */
  referenceValues() {
    const rows = this.db.all<{ kind: string; code: string; parent: string; label: string }>("SELECT kind, code, parent, label FROM reference_value WHERE status = 'ACTIVE' ORDER BY kind, parent, code");
    const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ code: r.code, parent: r.parent, label: r.label }));
    return { country: of('COUNTRY'), vehicleModel: of('VEHICLE_MODEL'), trim: of('TRIM') };
  }

  /** Epic 보기 패널 "FF 현황" — 읽기 전용 */
  async summary(featureId: string) {
    const versions = this.features.versions(featureId);
    if (!versions.length) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const d = this.epics.desired(featureId)!;
    const { working, released } = epicVersions(versions);
    const f = this.features.get(featureId, d.version)!;
    // 산출물은 저장된 결과, 없으면 지금 읽는다(codeBeamer 실패면 칸을 비운다)
    const v = this.wp.view(featureId, d.version) ?? (await this.wp.get(featureId, d.version).catch(() => null));
    return {
      featureId,
      name: f.name,
      scope: `${f.country}/${f.vehicleModel}/${f.trim}`,
      workingVersion: working?.version ?? null,
      releaseVersion: released?.version ?? null,
      version: d.version,
      lifecycle: d.lifecycle,
      epicStatus: JIRA_EPIC_STATUS[d.lifecycle],
      gates: d.fields.gates,
      workProducts: v ? { text: wpSummaryText(v.result), rate: v.result.rate, missing: v.result.kinds.filter((k) => k.required && !k.passed).map((k) => WORK_PRODUCT[k.kind].ko) } : null,
      link: d.fields.ffLink,
    };
  }
}
