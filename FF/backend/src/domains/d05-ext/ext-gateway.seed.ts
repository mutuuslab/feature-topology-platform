// P2 데모 시드 — 데모 활동이 켜진 DB에 한 번(meta 'seed-ext-gateway'). 실제 경로(발급·폐기, 연계 등록·실행, 규칙 등록, 메시지 받기, 정산 전송)로 만든다.
// 외부 API 키 3건(사용 중 2·폐기 1, 원문은 버린다), 연계 설정 3건(ERP 배치 활성·ERP 파일 비활성·DMS 실시간 활성), 등록 변환 규칙 1건,
// 메시지 변환 2건(성공·실패), 정산 두 달(두 달 전: 실패 뒤 재전송 성공, 직전 달: 주기 전송 성공).
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { previousPeriod, type Role } from '@ff/contracts';
import { demoActivityEnabled } from '../../demo-activity/demo-activity.seeder';
import type { Actor } from '../../kernel/actor';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { ApiKeyService } from './api-gateway/api-keys/api-key.service';
import { SettlementService } from './billing/settlement.service';
import { LegacyLinkService, LegacyMessageService, LegacyRuleService } from './legacy/legacy-config.service';

export const EXT_GATEWAY_SEED_META = 'seed-ext-gateway';
const who = (persona: string, role: Role, step: string): Actor => ({ id: `usr-${persona}`, role, correlationId: `seed-ext-gateway-${step}` });

@Injectable()
export class ExtGatewaySeeder implements OnApplicationBootstrap {
  private readonly log = new Logger('ExtGatewaySeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly keys: ApiKeyService,
    private readonly links: LegacyLinkService,
    private readonly rules: LegacyRuleService,
    private readonly messages: LegacyMessageService,
    private readonly settlement: SettlementService,
  ) {}

  onApplicationBootstrap() {
    if (!demoActivityEnabled() || this.db.get("SELECT value FROM meta WHERE key = ?", EXT_GATEWAY_SEED_META)) return;
    try {
      this.run();
      this.db.tx(() => this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', EXT_GATEWAY_SEED_META, this.clock.iso()));
    } catch (err) {
      this.log.error(`P2 데모 시드 실패: ${(err as Error).message}`);
    }
  }

  private run() {
    const csm = (s: string) => who('integrator', 'SECURITY_OFFICER', s);
    const impl = (s: string) => who('integrator', 'IMPLEMENTER', s);
    const today = this.clock.iso().slice(0, 10);
    const in90 = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
    // 외부 API 키 — 공장 ERP 주문 수집기(SYSTEM)·외부 감사 도구(조회 전용, 90일)·교체된 VOC 수집기(폐기)
    this.keys.issue(csm('key-erp'), { name: 'TMA 공장 주문 수집', system: 'TMA 공장 ERP', role: 'SYSTEM', reason: 'IF-12 주문 자동 가져오기' });
    this.keys.issue(csm('key-audit'), { name: '분기 감사 조회', system: '외부 감사 도구', role: 'AUDITOR', expiresOn: in90, reason: '분기 감사 증적 수집' });
    const old = this.keys.issue(csm('key-voc'), { name: '고객센터 VOC 수집', system: '고객센터 VOC(이전)', role: 'SYSTEM', reason: 'VOC 자동 수집' });
    this.keys.revoke(csm('key-voc-revoke'), old.keyId, { reason: '수집기 교체 — 새 수집기는 별도 키' });

    // 연계 설정 — 등록하면 브리지가 구성된다. ERP 배치는 활성으로 한 번 실행
    const erp = this.links.create(impl('link-erp'), { system: 'ERP-TMA', name: 'TMA 공장 ERP', kind: 'PLANT-ERP', endpoint: 'https://erp.tma.example/api/orders', bridgeType: 'BATCH', schedule: 'DAILY', plant: 'TMA', status: 'ACTIVE', note: '체코 공장 생산 주문' });
    this.links.create(impl('link-hma'), { system: 'ERP-HMA', name: 'HMA 공장 ERP(파일)', kind: 'PLANT-ERP', endpoint: 'sftp://files.hma.example/orders', bridgeType: 'FILE', schedule: 'WEEKLY', plant: 'HMA', status: 'INACTIVE', note: '파일 교환 전환 준비 중' });
    this.links.create(impl('link-dms'), { system: 'DMS-KR', name: '국내 딜러 DMS', kind: 'DEALER-DMS', endpoint: 'https://dms.example.kr/coding', bridgeType: 'REALTIME', schedule: null, plant: null, status: 'ACTIVE', note: '딜러 진단기 코딩 읽기' });
    this.links.run(who('operator', 'OPERATOR', 'bridge-erp'), erp.linkId);

    // 변환 규칙 — 중국 공장 내비 옵션(HMGC 주문의 미해석 코드)을 담당자가 등록
    this.rules.create(impl('rule-cnav'), { legacyCode: 'OPT-CNAV', system: 'PLANT-ERP', description: 'China Navigation Pack', featureId: 'FEAT-00024', note: 'HMGC 주문 옵션', reason: '중국 공장 내비 옵션 대응' });

    // 메시지 변환 — 딜러 진단기 코딩 읽기(성공)·모르는 코딩 위치(실패)
    const op = who('operator', 'OPERATOR', 'message');
    const readAt = this.clock.iso();
    this.messages.receive(op, { format: 'LGC-CODING-1', system: 'DMS-KR', vin: 'KMH-LF-0002', unit: 'BCM', records: [{ did: 'F1024', value: '01' }], readAt });
    this.messages.receive(op, { format: 'LGC-CODING-1', system: 'DMS-KR', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1999', value: '01' }], readAt });

    // 정산 — 두 달 전: 정산 연계가 꺼져 실패 → 다시 켠 뒤 재전송, 직전 달: 주기 전송
    const now = this.clock.iso();
    const last = previousPeriod(now);
    const before = previousPeriod(`${last}-15T00:00:00Z`);
    const ops = who('operator', 'OPERATOR', 'settlement');
    const prev = process.env.IF_MODE_SETTLEMENT;
    process.env.IF_MODE_SETTLEMENT = 'off';
    try {
      this.settlement.send(ops, before, 'MANUAL', '월 정산');
    } catch {
      // 실패가 의도 — 전송 기록·연계 오류 이력에 남았다
    } finally {
      if (prev === undefined) delete process.env.IF_MODE_SETTLEMENT;
      else process.env.IF_MODE_SETTLEMENT = prev;
    }
    this.settlement.send(ops, before, 'MANUAL', '연계 복구 뒤 재전송');
    this.settlement.runDue();
  }
}
