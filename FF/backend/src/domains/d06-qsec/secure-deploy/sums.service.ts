// SUMS 기록 (D06-08 보안 배포 관리, 보고서 v1.1 6.6 · FFG-LCY-008) — 발행된 kill_command v2(비활성화·복원)마다 SW 업데이트 기록을 남긴다:
// 대상 RXSWIN·형식승인 영향 평가·사용자 고지(contracts sumsEntry), 보존 기간(가장 긴 시장 Profile 요건), 그리고 회신 집계가 끝나면 결과.
// 기록은 추가만(019_sums 트리거) — 결과는 같은 명령의 RESULT 행으로 덧붙인다.
import { Controller, Get, Inject, Injectable, OnModuleInit, Query } from '@nestjs/common';
import { sumsEntry, sumsRetention, type KillCommandV2, type SumsEntry } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';

export interface SumsRecord extends SumsEntry {
  publicationId: string | null;
  recordedAt: string;
  retention: { yearsAfterProductionEnd: number; basis: string; unknown: string[] };
  result: { status: string; confirmed: number; denominator: number; at: string } | null;
}

@Injectable()
@PlatformComponent('D06-08')
export class SumsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
  ) {}

  onModuleInit() {
    this.events.stream(['kill.issued', 'kill.released', 'publication.closed']).subscribe((e) => {
      const p = e.payload as Record<string, any>;
      if (e.type === 'publication.closed') this.result(p.publicationId, p);
      else if (p.commandId) this.command(p.commandId, p.publicationId ?? null);
    });
  }

  /** 발행된 명령 → SUMS 명령 기록(같은 명령은 한 번) */
  command(commandId: string, publicationId: string | null) {
    if (this.db.get("SELECT 1 FROM sums_record WHERE command_id = ? AND kind = 'COMMAND'", commandId)) return;
    const row = this.db.get<{ doc: string }>('SELECT doc FROM kill_command WHERE command_id = ?', commandId);
    if (!row) return;
    const cmd = JSON.parse(row.doc) as KillCommandV2;
    const doc = { ...sumsEntry(cmd), retention: sumsRetention() };
    this.db.run(
      "INSERT INTO sums_record (command_id, kind, feature_id, publication_id, at, doc) VALUES (?, 'COMMAND', ?, ?, ?, ?)",
      commandId,
      cmd.feature.id,
      publicationId,
      this.clock.iso(),
      JSON.stringify(doc),
    );
  }

  /** 회신 집계 종료 → 그 게시본의 명령에 결과 행 */
  private result(publicationId: string, p: Record<string, any>) {
    const c = this.db.get<{ command_id: string; feature_id: string }>("SELECT command_id, feature_id FROM sums_record WHERE publication_id = ? AND kind = 'COMMAND'", publicationId);
    if (!c || this.db.get("SELECT 1 FROM sums_record WHERE command_id = ? AND kind = 'RESULT'", c.command_id)) return;
    const doc = { status: p.status, confirmed: p.confirmed ?? 0, denominator: p.denominator ?? 0, at: this.clock.iso() };
    this.db.run("INSERT INTO sums_record (command_id, kind, feature_id, publication_id, at, doc) VALUES (?, 'RESULT', ?, ?, ?, ?)", c.command_id, c.feature_id, publicationId, doc.at, JSON.stringify(doc));
  }

  list(featureId?: string): SumsRecord[] {
    const rows = this.db.all<{ command_id: string; kind: string; publication_id: string | null; at: string; doc: string }>(
      `SELECT command_id, kind, publication_id, at, doc FROM sums_record ${featureId ? 'WHERE feature_id = ?' : ''} ORDER BY id`,
      ...(featureId ? [featureId] : []),
    );
    const out = new Map<string, SumsRecord>();
    for (const r of rows) {
      const d = JSON.parse(r.doc);
      if (r.kind === 'COMMAND') out.set(r.command_id, { ...d, publicationId: r.publication_id, recordedAt: r.at, result: null });
      else if (out.has(r.command_id)) out.get(r.command_id)!.result = d;
    }
    return [...out.values()];
  }
}

@Controller('api')
export class SumsController {
  constructor(private readonly sums: SumsService) {}

  @Get('sums')
  list(@Query('featureId') featureId?: string) {
    return { items: this.sums.list(featureId), retention: sumsRetention() };
  }
}
