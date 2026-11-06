// 수집 정책(D04-03, 80-70 2장·6장 9, BACKLOG TL-UI09·TL-B05 읽기) — 어떤 신호를 어느 차량군에서 어떤 트리거로 모을지 FF가 정한다.
// 수집 정책은 Flag 정책과 같은 서명 게시본 경로로 차량에 내려가고 회신으로 적용을 확인한다(배포 화면 흐름 재사용).
// 이번 단계는 조회만 — 작성·승인·서명 배포 엔티티 흐름(TL-B05)은 다음 단계다.
import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import type { CollectionPolicyRow } from '@ff/contracts';
import { LakeLink } from '../../../adapters/lake/lake-reader';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';

@Injectable()
@PlatformComponent('D04-03')
export class CollectionPolicyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lake: LakeLink,
  ) {}

  list(): { connected: boolean; items: CollectionPolicyRow[] } {
    const items = this.db.all<{ doc: string }>('SELECT doc FROM collection_policy ORDER BY collection_id').map((r) => JSON.parse(r.doc) as CollectionPolicyRow);
    return { connected: !!this.lake.reader(), items };
  }

  save(row: CollectionPolicyRow) {
    this.db.run('INSERT INTO collection_policy (collection_id, status, doc) VALUES (?, ?, ?) ON CONFLICT(collection_id) DO UPDATE SET status = excluded.status, doc = excluded.doc', row.collectionId, row.status, JSON.stringify(row));
  }
}

@Controller('api/collection-policies')
export class CollectionPolicyController {
  constructor(private readonly svc: CollectionPolicyService) {}

  @Get()
  list() {
    return this.svc.list();
  }
}
