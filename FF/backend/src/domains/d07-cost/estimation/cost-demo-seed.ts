// SW 개발비 산정 데모 시드(C3 사용자 결정) — 엑셀 산정 도구 v1.3 예시 과제(BCM)를 FF Feature 10개 + 산정 과제 2건으로.
// 픽스처 data/fixtures/demo/cost-demo.json(tools/cost/demo-seed.ts가 만든다). Feature는 일반 등록(RegistryService.create)으로 만들어
// 등록 규칙(Feature DB 연결·유사 이름·ID 발급)을 그대로 거친다. 과제 하나는 DRAFT(엑셀 예시와 같은 계산), 하나는 제출·승인까지.
// 데모 Feature가 들어가는 설치(FF_SEED≠none, 기본 픽스처)에서, 산정 과제가 하나도 없고 Feature DB가 발행돼 있을 때만 넣는다.
// FF_COST_DEMO=off면 넣지 않는다.
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CreateFeatureBody, type CostCheckStatus, type CostLineInputs, type CostSettingsInput, type Role } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';
import { seedOf } from '../../../kernel/runtime-config';
import { RegistryService } from '../../d01-policy/registry/registry.service';
import { RefdbRepository } from '../../d01-policy/refdb/refdb.repository';
import { CostService } from './cost.service';

export const COST_DEMO_FILE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'demo', 'cost-demo.json');

export interface CostDemo {
  excelTotalCost: number;
  actors: { author: string; estimator: string; approver: string };
  features: { key: string; name: string; description: string; asil: string; refs: { refId: string; role: 'PRIMARY' | 'INCLUDED' }[] }[];
  projects: {
    name: string;
    target: string;
    features: string[];
    settings: CostSettingsInput;
    approve: { submit: string; approve: string } | null;
    checks: { no: number; status: CostCheckStatus; memo: string }[];
  }[];
  lines: Record<string, CostLineInputs>;
}

/**
 * 데모 Feature의 적용 시장(국가·차종) — 모두 KR·NX4 PE이면 산정 목록의 국가·차종 필터가 값 하나뿐이었다(2026-11-06).
 * 조합은 기존 Feature 데이터(data/fixtures/v0.81/features.json)에 있는 국가·차종만 쓰고, 시연 과제 이름의 차종(MX5 출입·CE1 와이퍼·SU2i 미러 등)에 맞춘다.
 * 개발비 계산은 기준 행·줄 입력만 보므로 합계(엑셀 예시 EST-0001)는 그대로다
 */
export const COST_DEMO_MARKET: Record<string, { country: string; vehicleModel: string }> = {
  'Body controller': { country: 'KR', vehicleModel: 'NX4 PE' },
  // 조명 제어는 KR·NX4 PE 그대로 — 전시 채우기가 같은 적용 범위의 시연 Feature(FEAT-00022)와 의존관계를 만든다
  'Lighting control': { country: 'KR', vehicleModel: 'NX4 PE' },
  'Access and locking': { country: 'EU', vehicleModel: 'MX5' },
  'Wiper and washer': { country: 'KR', vehicleModel: 'CE1' },
  'Windows and roof': { country: 'KR', vehicleModel: 'GN7' },
  'Mirrors': { country: 'ME', vehicleModel: 'SU2i' },
  'Low-voltage power management': { country: 'US', vehicleModel: 'CT2' },
  'Diagnostic services (UDS)': { country: 'EU', vehicleModel: 'NX4 PE' },
  'Bootloader and software update': { country: 'KR', vehicleModel: 'NE PE' },
  'Cybersecurity controls': { country: 'US', vehicleModel: 'LX2' },
};

export const costDemoEnabled = (env: NodeJS.ProcessEnv = process.env) => seedOf(env) !== 'none' && !env.FF_FIXTURES && env.FF_COST_DEMO !== 'off';

@Injectable()
export class CostDemoSeed implements OnModuleInit {
  private readonly log = new Logger('CostDemoSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cost: CostService,
    private readonly registry: RegistryService,
    private readonly refs: RefdbRepository,
  ) {}

  onModuleInit() {
    if (!costDemoEnabled()) return;
    this.cost.ensureBasis();
    if (this.db.get('SELECT 1 FROM cost_project LIMIT 1') || !this.refs.latestRelease()) return;
    const demo = JSON.parse(readFileSync(process.env.FF_COST_DEMO_FILE ?? COST_DEMO_FILE, 'utf8')) as CostDemo;
    const who = (id: string, role: Role) => ({ id, role, correlationId: `seed:cost-demo:${id}` });
    const author = who(demo.actors.author, 'FEATURE_AUTHOR');
    const est = who(demo.actors.estimator, 'COST_ESTIMATOR');
    const approver = who(demo.actors.approver, 'COST_APPROVER');
    const made = new Map<string, { featureId: string; version: string }>();
    for (const f of demo.features) {
      // HTTP 등록과 같은 스키마 기본값(tags 등)을 채운다 — 빠지면 Feature 목록이 깨진다
      const body = CreateFeatureBody.parse({
        name: f.name,
        description: f.description,
        requirementIds: ['REQ-BCM-COST-01'],
        ...(COST_DEMO_MARKET[f.key] ?? { country: 'KR', vehicleModel: 'NX4 PE' }),
        trim: 'Premium',
        ownerId: '바디제어기획팀',
        asil: f.asil,
        featureRefs: f.refs,
      });
      const r = this.registry.create(author, body);
      made.set(f.key, { featureId: r.featureId, version: r.version });
    }
    const ids: string[] = [];
    this.cost.quietly(() => {
      for (const p of demo.projects) {
        const { estId } = this.cost.create(est, { name: p.name, target: p.target, currency: 'KRW', settings: p.settings });
        ids.push(estId);
        for (const key of p.features) this.cost.addFeature(est, estId, made.get(key)!);
        for (const l of this.db.all<{ line_no: number; ref_id: string }>('SELECT line_no, ref_id FROM cost_line WHERE est_id = ? ORDER BY line_no', estId)) {
          const inputs = demo.lines[l.ref_id];
          if (inputs && Object.keys(inputs).some((k) => k !== 'qty' || inputs.qty !== 1)) this.cost.updateLine(est, estId, l.line_no, inputs);
        }
        for (const c of p.checks) this.cost.putCheck(est, estId, c.no, { status: c.status, memo: c.memo });
        if (p.approve) {
          this.cost.transition(est, estId, { action: 'SUBMIT', reason: p.approve.submit });
          this.cost.transition(approver, estId, { action: 'APPROVE', reason: p.approve.approve });
        }
      }
    });
    this.log.log(`SW 개발비 산정 데모 — Feature ${made.size}개, 과제 ${ids.join('·')}`);
  }
}
