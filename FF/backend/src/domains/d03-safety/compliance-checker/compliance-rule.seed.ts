// 컴플라이언스 룰 데모 시드 — 데모 활동이 켜진 DB에 한 번(meta 'seed-compliance-rules'). 실제 경로(등록·승인 요청·승인/반려·수정)로 만든다.
// 승인된 룰은 플랫폼 기본 규칙과 같은 기준이거나 데모 정책이 충족하는 기준만 — 데모 활동의 검증·배포 결과를 바꾸지 않는다.
// 승인 대기 1건(열린 요청)·반려 1건·만료 1건(종료일이 지난 룰을 첫 만료 점검이 Retired로 바꾸고 알린다)을 함께 보인다.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CreateComplianceRuleBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { DB, type Db } from '../../../kernel/db';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { ComplianceRuleService } from './compliance-rule.service';

export const COMPLIANCE_SEED_META = 'seed-compliance-rules';

const who = (persona: string, role: Actor['role']): Actor => ({ id: `usr-${persona}`, role, correlationId: `seed-compliance-${persona}` });
const STEWARD = who('steward', 'REGULATORY_OWNER');
const FSM = who('quality', 'SAFETY_OFFICER');
const CSM = who('integrator', 'SECURITY_OFFICER');

/** 데모 활동과 같은 조건 — 운영 모드·시드 없음은 끔, FF_DEMO_ACTIVITY=0 끔·1 강제, 5년 재생 데이터셋은 끔 */
export function complianceSeedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProduction(env) || seedOf(env) === 'none') return false;
  if (env.FF_DEMO_ACTIVITY === '0') return false;
  if (env.FF_DEMO_ACTIVITY === '1') return true;
  return env.FF_DATASET !== 'ops5y';
}

const MAJOR = ['UNECE', 'EU', 'UK', 'KR', 'US', 'CA', 'JP'];

@Injectable()
export class ComplianceRuleSeeder implements OnApplicationBootstrap {
  private readonly log = new Logger('ComplianceRuleSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rules: ComplianceRuleService,
  ) {}

  onApplicationBootstrap() {
    if (!complianceSeedEnabled()) return;
    try {
      this.run();
    } catch (err) {
      this.log.warn(`컴플라이언스 룰 시드를 건너뜁니다: ${(err as Error).message}`);
    }
  }

  /** 한 번만 — 먼저 meta 행을 잡는다. 시드한 룰 수 */
  run(): number {
    if (this.db.get('SELECT 1 FROM compliance_rule LIMIT 1')) return 0;
    const claimed = this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', COMPLIANCE_SEED_META, JSON.stringify({ state: 'DONE' }));
    if (!claimed.changes) return 0;
    const add = (by: Actor, b: Record<string, unknown>) => this.rules.create(by, CreateComplianceRuleBody.parse(b));
    const approve = (ruleId: string, by: Actor, approver: Actor, reason: string) => {
      this.rules.requestApproval(by, ruleId, { note: '검토 요청' });
      return this.rules.decide(approver, ruleId, { decision: 'APPROVE', reason });
    };

    add(FSM, {
      ruleId: 'CR-SAF-001',
      name: 'ASIL 기능 Safe Default 꺼짐',
      type: 'SAFETY',
      scope: { markets: MAJOR, asil: ['A', 'B', 'C', 'D'] },
      criteria: [{ check: 'SAFE_DEFAULT_OFF' }],
      approverIds: ['usr-steward'],
      evidence: { url: 'https://www.iso.org/standard/68385.html', docName: 'ISO 26262-3:2018', clause: '§7.4.2', memo: '안전 목표가 있는 기능의 기본값은 꺼짐' },
      validFrom: '2026-01-01',
      reason: '기능안전 기본 규칙 등록',
    });
    approve('CR-SAF-001', FSM, STEWARD, '안전 상태 기본값 조항 확인');
    // 근거 조항 보강 — Minor 증가(1.1), 다시 승인
    this.rules.update(FSM, 'CR-SAF-001', { evidence: { url: 'https://www.iso.org/standard/68385.html', docName: 'ISO 26262-3:2018', clause: '§7.4.2.3', memo: '안전 목표가 있는 기능의 기본값은 꺼짐 — 안전 상태 정의 조항' }, reason: '근거 조항 세분화' });
    approve('CR-SAF-001', FSM, STEWARD, '세분화한 조항 확인');

    add(STEWARD, {
      ruleId: 'CR-LEG-002',
      name: 'UN R156 SW 업데이트 요구사항 연결',
      type: 'LEGAL',
      scope: { markets: ['UNECE', 'EU', 'UK', 'JP', 'KR'] },
      criteria: [{ check: 'REQUIREMENT_TRACE' }, { check: 'MARKET_PROFILE_CONFIRMED' }],
      approverIds: ['usr-quality'],
      evidence: { url: 'https://unece.org/transport/documents/2021/03/standards/un-regulation-no-156-software-update-and-software-update', docName: 'UN Regulation No. 156', clause: '§7.1.1', memo: 'SW 업데이트는 요구사항과 시장 Profile 확인을 거친다' },
      validFrom: '2026-01-01',
    });
    approve('CR-LEG-002', STEWARD, FSM, 'R156 조항·시장 Profile 확인');

    add(STEWARD, {
      ruleId: 'CR-PRV-003',
      name: '차량 식별자로 대상 지정 금지',
      type: 'PRIVACY',
      scope: { markets: ['EU', 'KR'] },
      criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }],
      approverIds: ['usr-quality'],
      evidence: { url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', docName: 'GDPR', clause: 'Art. 25(2)', memo: '배포 대상은 차종·국가 등 속성으로 정한다' },
      validFrom: '2026-01-01',
    });
    approve('CR-PRV-003', STEWARD, FSM, '개인정보 최소 처리 원칙 확인');

    add(CSM, {
      ruleId: 'CR-SEC-004',
      name: 'CAL3 이상 Feature 코호트 단계 배포',
      type: 'SECURITY',
      scope: { markets: ['UNECE', 'EU', 'KR', 'US'], cal: ['CAL3', 'CAL4'] },
      criteria: [{ check: 'STAGED_ROLLOUT' }, { check: 'GATE_PASS', gate: 'G7' }],
      approverIds: ['usr-steward'],
      evidence: { url: 'https://www.iso.org/standard/70918.html', docName: 'ISO/SAE 21434:2021', clause: '§15.6', memo: '높은 보증 수준 기능은 단계 배포로 위험을 줄인다' },
      validFrom: '2026-11-01',
    });
    this.rules.requestApproval(CSM, 'CR-SEC-004', { note: '사이버보안 단계 배포 기준 검토 요청' });

    add(STEWARD, {
      ruleId: 'CR-LEG-005',
      name: '캐나다 결함 통지 Profile 확인',
      type: 'LEGAL',
      scope: { markets: ['CA'] },
      criteria: [{ check: 'MARKET_PROFILE_CONFIRMED' }],
      approverIds: ['usr-quality'],
      evidence: { url: 'https://laws-lois.justice.gc.ca/eng/acts/m-10.01/', docName: 'Motor Vehicle Safety Act', clause: 's. 10', memo: null },
      validFrom: '2026-01-01',
    });
    this.rules.requestApproval(STEWARD, 'CR-LEG-005', { note: '캐나다 출시 전 검토' });
    this.rules.decide(FSM, 'CR-LEG-005', { decision: 'REJECT', reason: 'NA-CA Profile 원문 확인이 끝난 뒤 다시 제안' });

    add(STEWARD, {
      ruleId: 'CR-PRV-006',
      name: 'EU 데이터 접근 임시 점검(상반기)',
      type: 'PRIVACY',
      scope: { markets: ['EU'] },
      criteria: [{ check: 'TARA_RECORDED' }],
      approverIds: ['usr-quality'],
      evidence: { url: 'https://eur-lex.europa.eu/eli/reg/2023/2854/oj', docName: 'Regulation (EU) 2023/2854 (Data Act)', clause: 'Art. 3', memo: '시행 준비 기간 임시 점검' },
      validFrom: '2026-01-01',
      validTo: '2026-06-30',
    });
    approve('CR-PRV-006', STEWARD, FSM, '임시 점검 기간 확인');
    // 종료일이 지난 룰 — 첫 만료 점검이 Retired로 바꾸고 알린다
    this.rules.sweep();
    return 6;
  }
}
