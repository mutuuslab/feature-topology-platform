// 산출물 게이트·전이 연결(80-50 §5.5, D-ALM-13) — 커널 GateHooks에 조건을 더한다(d01 게이트·전이 코드는 이 파일을 모른다).
//   정의 승인 G2·검증 G5·출시 G8 PASS와 해당 전이(APPROVED·VERIFIED·RELEASED)는 그 단계의 필수 산출물이 완결돼야 한다(wpStageBlockers).
//   정의 승인은 요구 ID가 codeBeamer에 있어야(FR-DEP-005-002). 승인 뒤 바뀐 산출물의 재판정 요청이 열려 있으면 다음 전이는 막힌다(§5.6).
//   막는 방식 FF_ALM_WP_GATE — enforce(막음)·warn(화면에 보이기만)·off. 기본: codeBeamer 실제 연결이면 enforce, 모의면 warn.
//   판정 직전 다시 읽기: 모의 연결은 바로(동기), 실제 연결은 5분 주기·화면 '다시 읽기' 결과를 쓴다(판정은 동기 경로라 HTTP를 기다리지 않는다).
//   판정되면(gate.judged) 그 게이트의 열린 재판정 요청을 닫고, PASS면 판정 증거(완결성 해시·항목 version)를 남긴다.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { WORK_PRODUCT, WP_GATE_STAGES, wpGateMode, wpStageBlockers, type Blocker, type FeatureVersionRow, type GateId, type Lifecycle } from '@ff/contracts';
import type { PlatformEvent } from '../../../../kernel/event.service';
import { GateHooks } from '../../../../kernel/gate-hooks';
import { ExtSyncService } from './ext-sync.service';
import { AlmWorkProductsService } from './alm-workproducts.service';

@Injectable()
export class AlmGateService implements OnModuleInit {
  constructor(
    private readonly hooks: GateHooks,
    private readonly sync: ExtSyncService,
    private readonly wp: AlmWorkProductsService,
  ) {}

  onModuleInit() {
    this.hooks.register({ gateBlockers: (f, gate, input) => this.gateBlockers(f, gate, input), transitionBlockers: (f, to) => this.transitionBlockers(f, to) });
    this.sync.extend({ onEvent: (ev) => this.onEvent(ev) });
  }

  private enforce() {
    return wpGateMode(process.env) === 'enforce';
  }

  /** 판정 직전 결과 — 모의는 지금 다시 읽고, 실제 연결은 저장된 결과(없으면 빈 결과로 계산 → 승인 0건으로 막힘) */
  private result(f: FeatureVersionRow) {
    this.wp.collectNow(f.featureId);
    return this.wp.compute(f.featureId, f.version).result;
  }

  private gateBlockers(f: FeatureVersionRow, gate: GateId, inputResult: string): string[] {
    if (inputResult !== 'PASS' || !this.enforce()) return [];
    const stage = WP_GATE_STAGES.find((s) => s.judgeGate === gate);
    if (!stage) return [];
    return wpStageBlockers(this.result(f), stage).map((p) => `${WORK_PRODUCT[p.kind].ko}: ${p.why}`);
  }

  private transitionBlockers(f: FeatureVersionRow, to: Lifecycle): Blocker[] {
    if (!this.enforce()) return [];
    const out: Blocker[] = [];
    const stage = WP_GATE_STAGES.find((s) => s.to === to);
    if (stage) {
      const r = this.result(f);
      for (const p of wpStageBlockers(r, stage)) out.push({ code: 'WORK_PRODUCT', message: `${WORK_PRODUCT[p.kind].ko}: ${p.why}`, ref: stage.judgeGate });
      if (to === 'APPROVED') {
        const missing = this.wp.view(f.featureId, f.version)?.requirementCheck.missing ?? [];
        if (missing.length) out.push({ code: 'WORK_PRODUCT', message: `요구 ID ${missing.join(', ')}이(가) codeBeamer에 없습니다 — 요구 ID를 확인하거나 codeBeamer에 등록하세요.`, ref: 'G2' });
      }
    }
    for (const r of this.wp.rejudges({ status: 'OPEN', featureId: f.featureId }).filter((x) => x.version === f.version))
      out.push({ code: 'REJUDGE_OPEN', message: `산출물 ${r.itemKey}(${r.itemTitle})이(가) 승인 뒤 바뀌었습니다(v${r.fromVersion} → v${r.toVersion}) — ${r.gate}을(를) 다시 판정한 뒤 전이할 수 있습니다.`, ref: r.gate });
    return out;
  }

  /** 판정 — 열린 재판정 요청 닫기, PASS면 판정 증거(정의 승인·검증·출시 판정 게이트) */
  private onEvent(ev: PlatformEvent) {
    if (ev.type !== 'gate.judged') return;
    const p = (ev.payload ?? {}) as { gate?: string; status?: string; gateRecordId?: string; by?: string };
    const [featureId, version] = ev.aggregate.split('@');
    if (!p.gate || !featureId || !version) return;
    this.wp.resolveRejudge(featureId, version, p.gate, p.by ?? 'system');
    if (p.status === 'PASS' && p.gateRecordId && WP_GATE_STAGES.some((s) => s.judgeGate === p.gate)) this.wp.writeEvidence(featureId, version, p.gate, p.gateRecordId);
  }
}
