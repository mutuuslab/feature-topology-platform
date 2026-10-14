// Gate Decision Record (D01-02, 보고서 v1.1 FFG-LCY-001) — Gate 판정마다 결정 본문(대상·판정·Evidence·승인자 역할·시각)을
// HSM 'gate' 용도 키로 서명해 gate_decision에 추가만 한다. Lifecycle 전이는 근거 Gate 기록의 결정 서명을 검증한다.
// 상세설계서 이관 기록(시드)은 부팅 때 provenance=IMPORT로 봉인한다(그 내용을 그대로 — 판정자 ID는 원본에 없어 null).
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { decisionPayload, decisionState, decisionUsable, jcs, type DecisionProvenance, type DecisionState, type GateDecision, type GateId, type GateRecordRow } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { FeatureRepo, GateRepo } from '../repos';

export interface DecisionView {
  state: DecisionState;
  reason: string | null;
  provenance: DecisionProvenance | null;
  kid: string | null;
  approver: { id: string | null; role: string } | null;
  signedAt: string | null;
}

@Injectable()
export class GateDecisionService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly hsm: HsmService,
    private readonly gates: GateRepo,
    private readonly features: FeatureRepo,
  ) {}

  /** 이관 기록 봉인 — 결정 기록이 없는 Gate 기록(시드)을 그 내용 그대로 서명한다. 여러 번 불러도 같다.
   *  모듈 초기화가 모두 끝난 뒤(정책 키가 KEY-0001로 먼저 생긴 뒤) 돈다 — 기존 키 번호를 바꾸지 않게 */
  onApplicationBootstrap() {
    const missing = this.db.all<{ doc: string }>('SELECT g.doc FROM gate_record g LEFT JOIN gate_decision d ON d.gate_record_id = g.gate_record_id WHERE d.gate_record_id IS NULL');
    if (!missing.length) return;
    this.db.tx(() => {
      for (const { doc } of missing) {
        const r = JSON.parse(doc) as GateRecordRow;
        this.sign(r, { id: null, role: r.judgeRole }, 'IMPORT', r.judgedAt);
      }
    });
  }

  /** 결정 서명 — 트랜잭션 안에서 Gate 기록과 함께 넣는다 */
  sign(r: GateRecordRow, approver: { id: string | null; role: string }, provenance: DecisionProvenance, signedAt = this.clock.iso()): GateDecision {
    const baselineId = this.features.get(r.featureId, r.featureVersion)?.baselineId ?? null;
    const payload = decisionPayload(r, approver, provenance, baselineId);
    const d: GateDecision = { payload, signature: this.hsm.signDetached('gate', jcs(payload)), signedAt };
    this.db.run('INSERT INTO gate_decision (gate_record_id, provenance, kid, signed_at, doc) VALUES (?, ?, ?, ?, ?)', r.gateRecordId, provenance, d.signature.kid, signedAt, JSON.stringify(d));
    return d;
  }

  get(gateRecordId: string): GateDecision | null {
    const row = this.db.get<{ doc: string }>('SELECT doc FROM gate_decision WHERE gate_record_id = ?', gateRecordId);
    return row ? (JSON.parse(row.doc) as GateDecision) : null;
  }

  /** Gate 기록의 결정 검증 — 서명(gate 용도 키)과, 지금 기록에서 다시 만든 본문이 서명된 본문과 같은지 */
  verify(r: GateRecordRow): DecisionView {
    const d = this.get(r.gateRecordId);
    const sigValid = !!d && this.hsm.verifyDetached('gate', jcs(d.payload), d.signature).valid;
    const s = decisionState(r, d, sigValid);
    return { ...s, provenance: d?.payload.provenance ?? null, kid: d?.signature.kid ?? null, approver: d?.payload.approver ?? null, signedAt: d?.signedAt ?? null };
  }

  /** 최신 Gate 기록 중 전이 근거로 쓸 수 없는 것 — Lifecycle 전이 검사(GATE_UNSIGNED) */
  unsigned(featureId: string, version: string): Partial<Record<GateId, string>> {
    const out: Partial<Record<GateId, string>> = {};
    for (const [g, r] of Object.entries(this.gates.latest(featureId, version)) as [GateId, GateRecordRow][]) {
      const v = this.verify(r);
      if (!decisionUsable(v.state)) out[g] = v.reason ?? v.state;
    }
    return out;
  }
}
