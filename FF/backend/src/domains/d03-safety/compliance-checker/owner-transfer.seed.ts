// 소유자 이관 데모 시드(F0, B13) — 컴플라이언스 룰 시드와 같은 조건, 한 번(meta 'seed-f0-owner-transfer'). 실제 경로(등록·이관)로 만든다.
// 떠난 법규 담당(데모 계정 표 밖 usr-reg-former)이 등록한 승인 대기 룰 둘: 하나는 시스템 관리자가 법규 담당(steward)에게 이관한 이력,
// 하나는 아직 소유자가 없는 상태(시스템 관리자 화면에 이관 버튼이 열린다). 둘 다 승인 전이라 배포 검증 결과를 바꾸지 않는다.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CreateComplianceRuleBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { DB, type Db } from '../../../kernel/db';
import { COMPLIANCE_SEED_META, complianceSeedEnabled } from './compliance-rule.seed';
import { ComplianceRuleService } from './compliance-rule.service';

export const OWNER_TRANSFER_SEED_META = 'seed-f0-owner-transfer';
const FORMER: Actor = { id: 'usr-reg-former', role: 'REGULATORY_OWNER', correlationId: 'seed-f0-former' };
const ADMIN: Actor = { id: 'usr-sysadmin', role: 'SYSTEM_ADMIN', correlationId: 'seed-f0-sysadmin' };

const body = (ruleId: string, name: string, clause: string) =>
  CreateComplianceRuleBody.parse({
    ruleId,
    name,
    type: 'PRIVACY',
    scope: { markets: ['EU'] },
    criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }],
    approverIds: ['usr-quality'],
    evidence: { url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', docName: 'GDPR', clause },
    validFrom: '2026-01-01',
    validTo: null,
    reason: '시장 진출 준비',
  });

@Injectable()
export class OwnerTransferSeeder implements OnApplicationBootstrap {
  private readonly log = new Logger('OwnerTransferSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rules: ComplianceRuleService,
  ) {}

  onApplicationBootstrap() {
    if (!complianceSeedEnabled()) return;
    try {
      this.run();
    } catch (err) {
      this.log.warn(`소유자 이관 시드를 건너뜁니다: ${(err as Error).message}`);
    }
  }

  /** 한 번만 — 먼저 meta 행을 잡는다. 만든 룰 수 */
  run(): number {
    // 룰 시드 뒤에만 — 룰 시드는 룰이 하나라도 있으면 건너뛰므로 먼저 만들면 안 된다
    if (!this.db.get('SELECT 1 FROM meta WHERE key = ?', COMPLIANCE_SEED_META)) return 0;
    const claimed = this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', OWNER_TRANSFER_SEED_META, JSON.stringify({ state: 'DONE' }));
    if (!claimed.changes) return 0;
    this.rules.create(FORMER, body('CR-PRV-090', 'EU 차량 위치 기록 보존 기간 고지', '제13조'));
    this.rules.transferOwner(ADMIN, 'CR-PRV-090', { toOwnerId: 'usr-steward', reason: '법규 담당 퇴사 — 같은 팀 담당자에게 이관' });
    this.rules.create(FORMER, body('CR-PRV-091', 'EU 차량 데이터 열람 요청 처리 기한', '제15조'));
    return 2;
  }
}
