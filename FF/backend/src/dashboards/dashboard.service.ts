// 대시보드(Jira식 가젯 판) 저장 — 사용자가 만든 판을 서버에 둔다(브라우저를 바꿔도 같은 판).
//  · 보기: 소유자이거나 내 플랫폼 역할 중 하나에 공유된 판. 못 보는 판은 있는지도 알리지 않는다(404)
//  · 바꾸기·지우기·공유: 소유자만(403). 남의 판은 사본을 만들어 고친다
//  · 겹친 저장: If-Match(버전, ETag "n") 또는 본문 version이 지금 버전과 다르면 412 — 화면이 최신 판을 다시 읽는다
//  · 재전송: Idempotency-Key는 커널 가로채기(IdempotencyInterceptor)가 처리한다(같은 키·같은 본문 → 처음 응답)
//  · 즐겨찾기(별)는 보는 사람별 — 소유자는 dashboard.favourite, 공유받은 사람은 dashboard_star
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Param, Post, Put, Res } from '@nestjs/common';
import {
  canViewDashboard,
  DashboardBoard,
  DashboardCreateBody,
  DashboardDeleteBody,
  DashboardFavouriteBody,
  DashboardUpdateBody,
  HUMAN_ROLES,
  type DashboardView,
  type Role,
} from '@ff/contracts';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { ZodPipe } from '../kernel/zod.pipe';

interface Row {
  id: string;
  owner_id: string;
  name: string;
  layout: string;
  shared_roles: string;
  version: number;
  favourite: number;
  created_at: string;
  updated_at: string;
}

const COMPONENT = 'KERNEL';
/** 한 사람이 가질 수 있는 판 수 — 저장소를 묶는다 */
const MAX_PER_OWNER = 50;

/** If-Match 값 → 버전 — "3", W/"3", 3 모두 받는다. 비었거나 *면 null */
export function ifMatchVersion(raw: string | undefined): number | null {
  const v = (raw ?? '').trim();
  if (!v || v === '*') return null;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(v);
  if (!m) throw new DomainError('VALIDATION', 'If-Match 값은 대시보드 버전(예: "3")이어야 합니다.', { ifMatch: v });
  return Number(m[1]);
}

const rolesOf = (actor: Actor): Role[] => (actor.roles?.length ? actor.roles : [actor.role]);

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private starred(actor: Actor, id: string): boolean {
    return !!this.db.get('SELECT 1 FROM dashboard_star WHERE actor_id = ? AND dashboard_id = ?', actor.id, id);
  }

  private view(r: Row, actor: Actor): DashboardView {
    const mine = r.owner_id === actor.id;
    return {
      id: r.id,
      name: r.name,
      ownerId: r.owner_id,
      sharedRoles: JSON.parse(r.shared_roles) as Role[],
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      favourite: mine ? !!r.favourite : this.starred(actor, r.id),
      mine,
      board: DashboardBoard.parse(JSON.parse(r.layout)),
    };
  }

  private visible(r: Row, actor: Actor) {
    return canViewDashboard({ ownerId: r.owner_id, sharedRoles: JSON.parse(r.shared_roles) as string[] }, { id: actor.id, roles: rolesOf(actor) });
  }

  /** 볼 수 있는 판 — 없거나 볼 수 없으면 404(남의 판이 있는지 알리지 않는다) */
  private row(actor: Actor, id: string): Row {
    const r = this.db.get<Row>('SELECT * FROM dashboard WHERE id = ?', id);
    if (!r || !this.visible(r, actor)) throw new DomainError('NOT_FOUND', '대시보드를 찾을 수 없습니다. 지워졌거나 공유가 풀렸을 수 있습니다.', { id });
    return r;
  }

  /** 소유자만 — 공유받은 판은 볼 수만 있다 */
  private owned(actor: Actor, id: string): Row {
    const r = this.row(actor, id);
    if (r.owner_id !== actor.id) throw new DomainError('FORBIDDEN', '다른 사람의 대시보드는 바꿀 수 없습니다. 사본을 만들어 고치세요.', { id, ownerId: r.owner_id });
    return r;
  }

  /** 겹친 저장 — 화면이 본 버전이 지금 버전이 아니면 412. 버전을 밝히지 않은 변경도 받지 않는다 */
  private expect(r: Row, version: number | null | undefined) {
    if (version == null) throw new DomainError('PRECONDITION_FAILED', '대시보드 버전(If-Match)이 필요합니다. 최신 판을 다시 읽고 저장하세요.', { version: r.version });
    if (version !== r.version) throw new DomainError('PRECONDITION_FAILED', '다른 곳에서 이 대시보드가 바뀌었습니다. 최신 판을 다시 불러와 주세요.', { version: r.version, updatedAt: r.updated_at });
  }

  list(actor: Actor): { items: DashboardView[] } {
    const rows = this.db.all<Row>('SELECT * FROM dashboard ORDER BY updated_at DESC, id');
    const items = rows.filter((r) => this.visible(r, actor)).map((r) => this.view(r, actor));
    // 내 판 먼저, 그다음 공유받은 판 — 같은 무리 안에서는 최근에 바뀐 것부터
    items.sort((a, b) => Number(b.mine) - Number(a.mine));
    return { items };
  }

  get(actor: Actor, id: string): DashboardView {
    return this.view(this.row(actor, id), actor);
  }

  create(actor: Actor, body: DashboardCreateBody): DashboardView {
    return this.db.tx(() => {
      const n = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM dashboard WHERE owner_id = ?', actor.id)?.n ?? 0;
      if (n >= MAX_PER_OWNER) throw new DomainError('CONFLICT', `대시보드는 한 사람이 ${MAX_PER_OWNER}개까지 만들 수 있습니다. 쓰지 않는 판을 지우세요.`);
      const id = `DSH-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      const at = this.clock.iso();
      const shared = [...new Set(body.sharedRoles)];
      this.db.run(
        'INSERT INTO dashboard (id, owner_id, name, layout, shared_roles, version, favourite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)',
        id,
        actor.id,
        body.name,
        JSON.stringify(body.board),
        JSON.stringify(shared),
        at,
        at,
      );
      this.audit.record(actor, 'DASHBOARD_CREATE', id, { after: { name: body.name, sharedRoles: shared, gadgets: body.board.columns.flat().length }, componentId: COMPONENT });
      return this.get(actor, id);
    });
  }

  update(actor: Actor, id: string, body: DashboardUpdateBody, ifMatch: number | null): DashboardView {
    return this.db.tx(() => {
      const r = this.owned(actor, id);
      this.expect(r, ifMatch ?? body.version);
      const name = body.name ?? r.name;
      const layout = body.board ? JSON.stringify(body.board) : r.layout;
      const shared = body.sharedRoles ? JSON.stringify([...new Set(body.sharedRoles)]) : r.shared_roles;
      const at = this.clock.iso();
      // 버전 조건을 다시 건다 — 같은 버전으로 두 요청이 겹쳐도 하나만 바뀐다
      const res = this.db.run('UPDATE dashboard SET name = ?, layout = ?, shared_roles = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', name, layout, shared, at, id, r.version);
      if (!res.changes) throw new DomainError('PRECONDITION_FAILED', '다른 곳에서 이 대시보드가 바뀌었습니다. 최신 판을 다시 불러와 주세요.', { id });
      // 감사는 판 내용 대신 바뀐 항목만 — 배치 끌기마다 큰 JSON을 쌓지 않는다
      const changed = [body.name !== undefined && body.name !== r.name && 'name', body.board && 'board', body.sharedRoles && shared !== r.shared_roles && 'sharedRoles'].filter(Boolean);
      this.audit.record(actor, 'DASHBOARD_UPDATE', id, {
        before: { name: r.name, sharedRoles: JSON.parse(r.shared_roles), version: r.version },
        after: { name, sharedRoles: JSON.parse(shared), version: r.version + 1, changed },
        componentId: COMPONENT,
      });
      return this.get(actor, id);
    });
  }

  remove(actor: Actor, id: string, ifMatch: number | null, body: { version?: number }) {
    return this.db.tx(() => {
      const r = this.owned(actor, id);
      this.expect(r, ifMatch ?? body.version);
      this.db.run('DELETE FROM dashboard WHERE id = ? AND version = ?', id, r.version);
      this.db.run('DELETE FROM dashboard_star WHERE dashboard_id = ?', id);
      this.audit.record(actor, 'DASHBOARD_DELETE', id, { before: { name: r.name, version: r.version }, componentId: COMPONENT });
      return { id, deleted: true };
    });
  }

  /** 별 — 보는 사람별. 버전을 올리지 않는다(판 내용이 아니다) */
  favourite(actor: Actor, id: string, favourite: boolean): DashboardView {
    return this.db.tx(() => {
      const r = this.row(actor, id);
      if (r.owner_id === actor.id) this.db.run('UPDATE dashboard SET favourite = ? WHERE id = ?', favourite ? 1 : 0, id);
      else if (favourite) this.db.run('INSERT OR IGNORE INTO dashboard_star (actor_id, dashboard_id, at) VALUES (?, ?, ?)', actor.id, id, this.clock.iso());
      else this.db.run('DELETE FROM dashboard_star WHERE actor_id = ? AND dashboard_id = ?', actor.id, id);
      return this.get(actor, id);
    });
  }
}

@Controller('api/dashboards')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.dashboards.list(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const d = this.dashboards.get(actor, id);
    res.setHeader('ETag', `"${d.version}"`);
    return d;
  }

  @Post()
  @Roles(...HUMAN_ROLES)
  @AuditAction('DASHBOARD_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(DashboardCreateBody)) body: DashboardCreateBody, @Res({ passthrough: true }) res: Response) {
    const d = this.dashboards.create(actor, body);
    res.setHeader('ETag', `"${d.version}"`);
    return d;
  }

  @Put(':id')
  @Roles(...HUMAN_ROLES)
  @AuditAction('DASHBOARD_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Body(new ZodPipe(DashboardUpdateBody)) body: DashboardUpdateBody, @Res({ passthrough: true }) res: Response) {
    const d = this.dashboards.update(actor, id, body, ifMatchVersion(ifMatch));
    res.setHeader('ETag', `"${d.version}"`);
    return d;
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles(...HUMAN_ROLES)
  @AuditAction('DASHBOARD_DELETE')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Headers('if-match') ifMatch: string | undefined, @Body(new ZodPipe(DashboardDeleteBody)) body: { version?: number }) {
    return this.dashboards.remove(actor, id, ifMatchVersion(ifMatch), body ?? {});
  }

  @Put(':id/favourite')
  @Roles(...HUMAN_ROLES)
  favourite(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(DashboardFavouriteBody)) body: { favourite: boolean }) {
    return this.dashboards.favourite(actor, id, body.favourite);
  }
}
