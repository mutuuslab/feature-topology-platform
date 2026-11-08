// 권한 범위 (D06-09 · ADS-BE15 · FFP-F057) — 역할 권한(커널 RolesGuard) 위에 계정별 시장·Feature·환경 범위를 겹친다.
// 종료(긴급 차단)·해제(복원·레거시 해제)·발행(정책 배포) 명령은 대상 Feature의 시장·Feature·지금 환경이 계정 범위 안이어야 한다 — 밖이면 403 SCOPE_DENIED + 감사 DENIED.
// 범위 지정은 추가만(지금 범위 = 계정의 마지막 행). 지정 권한은 사이버보안 담당(시스템 관리자 역할이 생기면 옮긴다). 규칙은 contracts rules/role-scope.ts.
import { Body, CallHandler, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, NestInterceptor, OnModuleInit, Param, Put } from '@nestjs/common';
import { AdsConfigFixture, marketOf, PutRoleScopeBody, ROUTES, scopeViolation, SCOPED_COMMANDS, type RoleScope, type ScopeTarget } from '@ff/contracts';
import type { Request } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Observable } from 'rxjs';
import { actorOf, AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';

/** 시드 — 범위는 ADS 구성 픽스처(data/fixtures/ads/config.json roleScopes) */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'config.json');
/** 지금 설치 환경 — FF_ENV(production 등), 없으면 demo */
export const currentEnvironment = (env: NodeJS.ProcessEnv = process.env) => (env.FF_ENV ?? '').trim() || 'demo';

/** 범위를 보는 명령 — 메서드 + 경로 → 이름 */
const SCOPED = new Map(ROUTES.filter((r) => (SCOPED_COMMANDS as readonly string[]).includes(r.name)).map((r) => [`${r.method} ${r.path}`, r.name]));

type Ago = { minutes?: number; hours?: number; days?: number };
const agoMs = (a: Ago) => ((a.days ?? 0) * 24 * 60 + (a.hours ?? 0) * 60 + (a.minutes ?? 0)) * 60_000;

@Injectable()
@PlatformComponent('D06-09')
export class RoleScopeService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly features: FeatureRepo,
  ) {}

  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(FIXTURE) || this.db.get('SELECT 1 FROM role_scope LIMIT 1')) return;
    const fx = AdsConfigFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const now = this.clock.now().getTime();
    this.db.tx(() => {
      for (const s of fx.roleScopes) {
        const at = new Date(now - agoMs(s.assignedAgo)).toISOString();
        const doc: RoleScope = { accountId: s.accountId, markets: s.markets, featureIds: s.featureIds, environments: s.environments, assignedBy: s.assignedBy, assignedAt: at, reason: s.reason };
        this.db.run('INSERT INTO role_scope (account_id, doc, assigned_by, assigned_at) VALUES (?, ?, ?, ?)', s.accountId, JSON.stringify(doc), s.assignedBy, at);
      }
    });
  }

  /** 계정마다 지금 범위(마지막 행) */
  list(): RoleScope[] {
    return this.db
      .all<{ doc: string }>('SELECT r.doc FROM role_scope r WHERE r.id = (SELECT max(id) FROM role_scope x WHERE x.account_id = r.account_id) ORDER BY r.account_id')
      .map((r) => JSON.parse(r.doc) as RoleScope);
  }

  of(accountId: string): RoleScope | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM role_scope WHERE account_id = ? ORDER BY id DESC LIMIT 1', accountId);
    return r ? (JSON.parse(r.doc) as RoleScope) : null;
  }

  history(accountId: string): RoleScope[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM role_scope WHERE account_id = ? ORDER BY id', accountId).map((r) => JSON.parse(r.doc) as RoleScope);
  }

  view() {
    return { items: this.list(), environment: currentEnvironment(), commands: [...SCOPED_COMMANDS] };
  }

  put(actor: Actor, accountId: string, body: PutRoleScopeBody): RoleScope {
    if (!/^[A-Za-z0-9._:@-]{2,80}$/.test(accountId)) throw new DomainError('VALIDATION', `계정 ${accountId} 형식이 맞지 않습니다.`);
    const before = this.of(accountId);
    const doc: RoleScope = { accountId, markets: body.markets, featureIds: body.featureIds, environments: body.environments, assignedBy: actor.id, assignedAt: this.clock.iso(), reason: body.reason };
    return this.db.tx(() => {
      this.db.run('INSERT INTO role_scope (account_id, doc, assigned_by, assigned_at) VALUES (?, ?, ?, ?)', accountId, JSON.stringify(doc), actor.id, doc.assignedAt);
      this.audit.record(actor, 'ROLE_SCOPE_PUT', accountId, { before: before ? { markets: before.markets, featureIds: before.featureIds, environments: before.environments } : null, after: { markets: doc.markets, featureIds: doc.featureIds, environments: doc.environments }, reason: body.reason, componentId: 'D06-09' });
      return doc;
    });
  }

  /** 명령 대상 — 긴급 차단 요청은 본문 Feature, 그 밖은 차단 요청·정책의 Feature. 대상을 찾지 못하면 null(각 서비스의 404에 맡긴다) */
  target(command: string, req: Request): ScopeTarget | null {
    let ref: { featureId: string; version: string } | null = null;
    if (command === 'issueKill') {
      const b = (req.body ?? {}) as { featureId?: unknown; featureVersion?: unknown };
      if (typeof b.featureId === 'string' && typeof b.featureVersion === 'string') ref = { featureId: b.featureId, version: b.featureVersion };
    } else if (command === 'deployPolicy') {
      const r = this.db.get<{ feature_id: string; feature_version: string }>('SELECT feature_id, feature_version FROM policy WHERE policy_id = ?', String(req.params?.id ?? ''));
      if (r) ref = { featureId: r.feature_id, version: r.feature_version };
    } else {
      const r = this.db.get<{ doc: string }>('SELECT doc FROM kill_request WHERE kill_id = ?', String(req.params?.id ?? ''));
      const d = r ? (JSON.parse(r.doc) as { featureId?: string; featureVersion?: string }) : null;
      if (d?.featureId) ref = { featureId: d.featureId, version: d.featureVersion ?? '' };
    }
    if (!ref) return null;
    const f = this.features.get(ref.featureId, ref.version);
    return { featureId: ref.featureId, market: f ? marketOf(f.country) : null, environment: currentEnvironment() };
  }

  /** 범위 검사 — 밖이면 거부 기록 후 403 */
  enforce(command: string, req: Request) {
    const actor = actorOf(req);
    const scope = this.of(actor.id);
    if (!scope) return;
    const t = this.target(command, req);
    if (!t) return;
    const v = scopeViolation(scope, t);
    if (!v) return;
    this.audit.denied(actor, command, req.path, `권한 범위 밖 — ${v.message}`, 'D06-09');
    throw new DomainError('FORBIDDEN', `권한 범위 밖이라 이 명령을 할 수 없습니다 — ${v.message}`, { code: 'SCOPE_DENIED', axis: v.axis, target: t });
  }
}

/** 종료·해제·발행 명령에 권한 범위를 겹친다 — 커널 RolesGuard(신원·역할) 뒤, 처리기 앞 */
@Injectable()
export class RoleScopeInterceptor implements NestInterceptor {
  constructor(private readonly scopes: RoleScopeService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') {
      const req = ctx.switchToHttp().getRequest<Request>();
      const name = req.route?.path ? SCOPED.get(`${req.method} ${req.route.path}`) : undefined;
      if (name) this.scopes.enforce(name, req);
    }
    return next.handle();
  }
}

@Controller('api/iam')
export class RoleScopeController {
  constructor(private readonly scopes: RoleScopeService) {}

  @Get('scopes')
  list() {
    return this.scopes.view();
  }

  @Put('scopes/:accountId')
  @HttpCode(200)
  @Roles('SECURITY_OFFICER')
  @AuditAction('ROLE_SCOPE_PUT')
  put(@CurrentActor() actor: Actor, @Param('accountId') accountId: string, @Body(new ZodPipe(PutRoleScopeBody)) body: PutRoleScopeBody) {
    return this.scopes.put(actor, accountId, body);
  }
}
