// 고객 기준 값 (D02-01 Variant 조건 관리) — 출시 준비 RD-OPS-03. 판매국·지역·차종·트림은 설치마다 등록한다.
// 데모 데이터셋 값은 데모 시드(kernel/seed.ts seedReferenceValues, origin SEED)일 뿐이고, 고객 설치(시드 없음)는 빈 목록에서 시작한다.
// 쓰인 값은 지우지 않는다(차량·Feature 적용 범위가 그 문자열을 가진다) — 사용 중지(RETIRED)하면 새 차량 등록·화면 선택지에서만 빠진다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { REFERENCE_KINDS, ReferenceRetireBody, ReferenceValueBody, referenceValueProblems, type ReferenceKind, type ReferenceValue } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';

interface Row {
  kind: ReferenceKind;
  code: string;
  parent: string;
  label: string;
  origin: ReferenceValue['origin'];
  status: ReferenceValue['status'];
  created_at: string;
  created_by: string;
}

const view = (r: Row): ReferenceValue => ({ kind: r.kind, code: r.code, label: r.label, parent: r.parent || null, origin: r.origin, status: r.status, createdAt: r.created_at, createdBy: r.created_by });

@Injectable()
@PlatformComponent('D02-01')
export class ReferenceValuesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  all(kind?: string): ReferenceValue[] {
    if (kind !== undefined && kind !== '' && !(REFERENCE_KINDS as readonly string[]).includes(kind)) throw new DomainError('VALIDATION', `기준 값 종류는 ${REFERENCE_KINDS.join('·')} 중 하나입니다.`, { kind });
    const rows = kind ? this.db.all<Row>('SELECT * FROM reference_value WHERE kind = ? ORDER BY kind, parent, code', kind) : this.db.all<Row>('SELECT * FROM reference_value ORDER BY kind, parent, code');
    return rows.map(view);
  }

  create(actor: Actor, body: ReferenceValueBody): ReferenceValue {
    const problems = referenceValueProblems(body, this.all());
    if (problems.length) throw new DomainError('VALIDATION', problems.join(' · '), { problems });
    if (this.db.get('SELECT 1 FROM reference_value WHERE kind = ? AND parent = ? AND code = ?', body.kind, body.parent ?? '', body.code)) throw new DomainError('CONFLICT', `${body.kind} ${body.code}은(는) 이미 등록돼 있습니다.`);
    const row: Row = { kind: body.kind, code: body.code, parent: body.parent ?? '', label: body.label, origin: 'CUSTOMER', status: 'ACTIVE', created_at: this.clock.iso(), created_by: actor.id };
    this.db.tx(() => {
      this.db.run('INSERT INTO reference_value (kind, code, parent, label, origin, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', row.kind, row.code, row.parent, row.label, row.origin, row.status, row.created_at, row.created_by);
      this.audit.record(actor, 'REFERENCE_VALUE_CREATE', `${row.kind}:${row.parent ? row.parent + '/' : ''}${row.code}`, { after: view(row), componentId: 'D02-01' });
    });
    return view(row);
  }

  /** 사용 중지 — 같은 코드가 여러 부모 아래 있으면 본문 parent로 고른다. 이미 중지면 409 */
  retire(actor: Actor, kind: string, code: string, parent: string | undefined, reason: string): ReferenceValue {
    const hits = this.db.all<Row>('SELECT * FROM reference_value WHERE kind = ? AND code = ?' + (parent !== undefined ? ' AND parent = ?' : ''), ...[kind, code, ...(parent !== undefined ? [parent] : [])]);
    if (!hits.length) throw new DomainError('NOT_FOUND', `${kind} ${code} 기준 값을 찾을 수 없습니다.`);
    if (hits.length > 1) throw new DomainError('VALIDATION', `${kind} ${code}이(가) 여러 부모 아래 있습니다 — parent를 지정하세요.`, { parents: hits.map((h) => h.parent) });
    const r = hits[0];
    if (r.status === 'RETIRED') throw new DomainError('CONFLICT', `${kind} ${code}은(는) 이미 사용 중지됐습니다.`);
    const next: Row = { ...r, status: 'RETIRED' };
    this.db.tx(() => {
      this.db.run("UPDATE reference_value SET status = 'RETIRED', retired_at = ?, retired_reason = ? WHERE kind = ? AND parent = ? AND code = ?", this.clock.iso(), reason, r.kind, r.parent, r.code);
      this.audit.record(actor, 'REFERENCE_VALUE_RETIRE', `${r.kind}:${r.parent ? r.parent + '/' : ''}${r.code}`, { before: { status: r.status }, after: { status: 'RETIRED' }, reason, componentId: 'D02-01' });
    });
    return view(next);
  }
}

@Controller('api/reference-values')
export class ReferenceValuesController {
  constructor(private readonly s: ReferenceValuesService) {}

  @Get()
  list(@Query('kind') kind?: string) {
    return { items: this.s.all(kind), kinds: REFERENCE_KINDS };
  }

  @Post()
  @Roles('VARIANT_OWNER')
  @AuditAction('REFERENCE_VALUE_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(ReferenceValueBody)) body: ReferenceValueBody) {
    return this.s.create(actor, body);
  }

  @Post(':kind/:code/retire')
  @HttpCode(200)
  @Roles('VARIANT_OWNER')
  @AuditAction('REFERENCE_VALUE_RETIRE')
  retire(@CurrentActor() actor: Actor, @Param('kind') kind: string, @Param('code') code: string, @Body(new ZodPipe(ReferenceRetireBody)) body: ReferenceRetireBody) {
    return this.s.retire(actor, kind, code, body.parent, body.reason);
  }
}
