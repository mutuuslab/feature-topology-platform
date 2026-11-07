// 예외 승인 데모 시드(GX) — 데모 활동이 켜졌을 때 실제 서비스 경로(요청 → 2인 승인·반려 → 만료 확인)로 예외 몇 건을 남긴다.
// 출시 전(G8·G9 미통과) VERIFIED Version에 PENDING Gate 예외: 적용 중 1건·1차 승인 1건·반려 1건, 지난 시각에 적용해 만료된 1건(배포가 없어 원복할 것 없음).
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { FeatureRepo, GateRepo } from '../../d01-policy/repos';
import { demoActivityEnabled } from '../../../demo-activity/demo-activity.seeder';
import { ExceptionPolicyService } from './exception-policy.service';

const who = (persona: string, role: Actor['role']): Actor => ({ id: `usr-${persona}`, role, correlationId: 'seed-exceptions' });
const REQUESTER = who('coordinator', 'RELEASE_MANAGER');
const FSM = who('quality', 'SAFETY_OFFICER');
const OPSLEAD = who('opslead', 'OPS_LEAD');
const HOUR = 3600_000;

@Injectable()
export class ExceptionPolicySeeder implements OnApplicationBootstrap {
  private readonly log = new Logger('ExceptionSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly svc: ExceptionPolicyService,
  ) {}

  onApplicationBootstrap() {
    if (!demoActivityEnabled() || this.db.get('SELECT 1 FROM exception_policy LIMIT 1')) return;
    try {
      this.seed();
    } catch (e) {
      this.log.warn(`예외 데모 시드 건너뜀: ${(e as Error).message}`);
    }
  }

  /** 출시 Gate(G8·G9)가 PASS도 FAIL도 아닌 VERIFIED Version — PENDING Gate 예외 대상 */
  private candidates() {
    return this.features
      .all()
      .filter((f) => f.lifecycle === 'VERIFIED')
      .map((f) => {
        const latest = this.gates.latest(f.featureId, f.version);
        const pending = (['G8', 'G9'] as const).filter((g) => latest[g]?.status !== 'PASS');
        return { f, pending, failed: pending.some((g) => latest[g]?.status === 'FAIL') };
      })
      .filter((x) => x.pending.length && !x.failed);
  }

  private seed() {
    const list = this.candidates();
    if (!list.length) return;
    const now = this.clock.now().getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    const req = (c: (typeof list)[number], restriction: 'LIMITED' | 'PILOT', reason: string, risk: string, periodHours: number) =>
      this.svc.create(REQUESTER, {
        kind: 'GATE_PENDING',
        featureId: c.f.featureId,
        featureVersion: c.f.version,
        policyId: null,
        checks: [],
        ruleIds: [],
        gates: [...c.pending],
        restriction,
        reason,
        periodHours,
        dueDate: iso(now + 14 * 24 * HOUR).slice(0, 10),
        residualRisk: risk,
      });
    /** 단계 하나 — 후보가 적어 같은 대상이 겹치면(열린 예외 중복) 그 단계만 건너뛴다 */
    const step = (name: string, fn: () => void) => {
      try {
        fn();
      } catch (e) {
        this.log.warn(`${name} 건너뜀: ${(e as Error).message}`);
      }
    };
    const approve = (id: string, a: Actor, expiresAt: number, reason: string) => this.svc.decide(a, id, { decision: 'APPROVE', reason, expiresAt: iso(expiresAt) });
    // ① 지난 시각에 적용 → 만료(배포가 없어 되돌릴 정책 상태 없음)
    const [c1, c2, c3, c4] = [list[0], list[1] ?? list[0], list[2] ?? list[0], list[3] ?? list[0]];
    const past = now - 4 * 24 * HOUR;
    step('만료', () =>
      this.clock.at(iso(past), () => {
        const e = req(c1, 'PILOT', '부품 수급 지연 차량군 우선 확인 — 운영 Gate 판정 전 지정 차량만', '야간·우천 주행 관측 부족', 24);
        approve(e.exceptionId, FSM, past + 20 * HOUR, '지정 차량 범위 확인');
        approve(e.exceptionId, OPSLEAD, past + 24 * HOUR, '운영 관측 계획 확인');
      }),
    );
    this.svc.sweep();
    // ② 적용 중 — 제한 배포(5%)까지
    step('적용 중', () => {
      const active = req(c2, 'LIMITED', '현장 품질 문의 대응 — 출시 판정 전 제한 배포로 개선 효과 확인', '운영 Gate 판정 전 — 장기 내구 관측 미완', 72);
      approve(active.exceptionId, FSM, now + 48 * HOUR, '제한 배포 범위·관측 기준 확인');
      approve(active.exceptionId, OPSLEAD, now + 72 * HOUR, '중단 기준·연락 체계 확인');
    });
    // ③ 1차 승인 — 두 번째 승인 대기
    step('1차 승인', () => {
      const waiting = req(c3, 'PILOT', '시험 차량 운영 일정 — 출시 판정 전 Pilot 범위만', '출시 Gate 판정 근거 일부 미제출', 48);
      approve(waiting.exceptionId, FSM, now + 36 * HOUR, 'Pilot 범위 확인');
    });
    // ④ 반려 — 잔여 리스크 근거 부족
    step('반려', () => {
      const rejected = req(c4, 'LIMITED', '판매 일정 맞춤 — 출시 판정 전 제한 배포', '근거 문서 준비 중', 72);
      this.svc.decide(OPSLEAD, rejected.exceptionId, { decision: 'REJECT', reason: '잔여 리스크 근거가 부족합니다 — 운영 Gate 판정 뒤 다시 요청하세요' });
    });
  }
}
