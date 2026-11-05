// 선택 시연 데이터 — 기본 예시 과제2건은 그대로 두고 FF_SHOWCASE=1에서만 과제22건을 더 만든다.
// 상태·승인·후속 실적은 도메인 메서드로만 남긴다. 모든 값은 시연용이며 실제 견적이나 실적이 아니다.
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type { Actor } from '../../../kernel/actor';
import { DB, type Db } from '../../../kernel/db';
import { isProduction } from '../../../kernel/runtime-config';
import { FeatureRepo } from '../../d01-policy/repos';
import { COST_DEMO_FILE, costDemoEnabled, type CostDemo } from './cost-demo-seed';
import { CostService } from './cost.service';

@Injectable()
export class CostShowcaseSeed implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Db, private readonly cost: CostService, private readonly features: FeatureRepo) {}

  onApplicationBootstrap() {
    if (process.env.FF_SHOWCASE !== '1' || isProduction() || !costDemoEnabled() || this.db.get("SELECT 1 FROM meta WHERE key = 'seed:cost-showcase:c4:double'")) return;
    const demo = JSON.parse(readFileSync(process.env.FF_COST_DEMO_FILE ?? COST_DEMO_FILE, 'utf8')) as CostDemo;
    const byName = new Map(this.features.all().map((feature) => [feature.name, feature]));
    const choices = demo.features.map((feature) => byName.get(feature.name));
    if (!choices.length || choices.some((feature) => !feature)) return;
    const estimator: Actor = { id: demo.actors.estimator, role: 'COST_ESTIMATOR', correlationId: 'seed:cost-showcase' };
    const approver: Actor = { id: demo.actors.approver, role: 'COST_APPROVER', correlationId: 'seed:cost-showcase' };
    const names = ['NX4 PE BCM 양산 변경', 'MX5 출입·잠금 개선', 'GN7 실내 조명 파생', 'EV9 디지털 키 연계', 'CT2 저전압 전원 검토', 'CE1 와이퍼 진단 개선', 'SU2i 미러 제어 확장', 'NE PE 업데이트 개선', 'LX2 보안 진단 보완', 'GN8 바디 통합 재사용', 'NX4 EU OTA 변경 영향', 'MX5 북미 도어 진단', 'GN7 후석 조명 재사용', 'EV9 스마트폰 키 보완', 'CT2 전원 절약 파생', 'CE1 우적 센서 협력사 검토', 'SU2i 미러 메모리 검토', 'NE PE 충전 알림 개선', 'LX2 보안 로그 추가', 'GN8 지역 사양 분리', 'EV9 양산 안정화 재산정', 'MX5 공급사 변경 재검토'];
    const from = this.db.get("SELECT 1 FROM meta WHERE key = 'seed:cost-showcase:c4'") ? 10 : 0;
    this.db.tx(() => {
      const approved: string[] = [];
      this.cost.quietly(() => {
        names.forEach((name, index) => {
          if (index < from) return;
          const settings = JSON.parse(JSON.stringify(demo.projects[0].settings));
          const { estId } = this.cost.create(estimator, { name: `${name} (시연)`, target: name, currency: 'KRW', settings });
          for (let offset = 0; offset < 1 + index % 3; offset++) {
            const feature = choices[(index + offset) % choices.length]!;
            this.cost.addFeature(estimator, estId, { featureId: feature.featureId, version: feature.version });
          }
          for (const line of this.db.all<{ line_no: number }>('SELECT line_no FROM cost_line WHERE est_id = ? ORDER BY line_no', estId)) this.cost.updateLine(estimator, estId, line.line_no, { qty: 1 + index % 2, variants: 1 + index % 3 });
          this.cost.putCheck(estimator, estId, 1, { status: index % 2 ? '확인' : '보완 필요', memo: '시연용 구매 검토' });
          if (index % 3) this.cost.transition(estimator, estId, { action: 'SUBMIT', reason: '시연용 검토 요청' });
          if (index % 3 === 2) {
            this.cost.transition(approver, estId, { action: 'APPROVE', reason: '서로 다른 담당자의 시연 승인' });
            approved.push(estId);
          }
        });
      });
      approved.forEach((estId, index) => {
        const detail = this.cost.detail(estimator, estId);
        const lines = detail.result?.lines.filter((line) => line.effQty > 0).slice(0, 3) ?? [];
        this.cost.quietly(() => { for (const line of lines) this.cost.putActual(estimator, estId, line.refId, { actual: Math.max(0.01, Math.round(line.e * (0.8 + index * 0.15) * 100) / 100) }); });
      });
      this.db.run("INSERT INTO meta (key, value) VALUES ('seed:cost-showcase:c4', '1') ON CONFLICT(key) DO NOTHING");
      this.db.run("INSERT INTO meta (key, value) VALUES ('seed:cost-showcase:c4:double', '1')");
    });
  }
}
