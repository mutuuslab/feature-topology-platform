// GLEO 와이어 v2 (보고서 v1.1 부록 D·13.3.1) — 브로커로 차량마다 서명된 kill_command v2 봉투를 보내고,
// 차량이 state_auth로 서명한 status_report v2를 6단계 수신 검사에 넘긴다. 이 시험은 브로커 없이 어댑터를 직접 구동한다
// (보낸 메시지는 기록만, 차량 역할은 시험이 플랫폼 계약으로 수행 — FF_IMP 실연동은 gleo.ws.spec).
// FFG-PLT-012 · FFG-TEL-003 · FFG-VEH-002
Object.assign(process.env, {
  FF_SCHEDULER: "manual",
  GLEO_MODE: "ws",
  GLEO_URL: "ws://127.0.0.1:9",
});
import { afterAll, describe, expect, it } from "vitest";
import {
  jcs,
  statusAuthCanonical,
  wireErrors,
  KillCommandV2,
  type StatusReportV2,
} from "@ff/contracts";
import { vehiclePseudonym } from "../../src/kernel/crypto";
import { GleoAdapter } from "../../src/adapters/gleo/gleo.adapter";
import { HsmService } from "../../src/domains/d06-qsec/pki-kms/hsm.service";
import { bootApp, killV2 } from "../helpers";

let close: (() => Promise<void>) | null = null;
afterAll(async () => {
  await close?.();
  for (const k of ["FF_SCHEDULER", "GLEO_MODE", "GLEO_URL"])
    delete process.env[k];
});

/** 차량(Guard) 역할 — 봉투를 검증하고 단계 보고를 차량 키로 서명한다 */
function vehicleReport(
  hsm: HsmService,
  env: KillCommandV2,
  state: StatusReportV2["state"],
  counter: number,
  over: Partial<StatusReportV2> = {},
) {
  const vin = env.scope.vehicle_ids[0];
  const r = {
    type: "status_report",
    schema_version: "2.0",
    vehicle_pseudonym: vehiclePseudonym(vin),
    feature: { id: env.feature.id, version: env.feature.version },
    state,
    reason: { category: env.reason.category, source: "REMOTE" },
    request_result: state === "DEACT_WARNING" ? "ACCEPTED" : "NONE",
    vehicle_seq: env.vehicle_auth!.vehicle_seq,
    durable: true,
    hmi: state === "DISABLED" ? "INFO_DISABLED" : "WARN_TAKEOVER",
    feature_weight_permille: state === "DISABLED" ? 0 : 1000,
    edr_aligned_state: "OFF_BY_COMMAND",
    observed_at: "2026-10-12T01:00:05.000Z",
    time_sync: "SYNCED",
    data_category: "SAFETY_OPERATION",
    key_epoch: env.vehicle_auth!.key_epoch,
    report_seq: (1 << 16) | counter,
    persistence: "DURABLE",
    ...over,
  } as Omit<StatusReportV2, "state_auth">;
  return {
    ...r,
    state_auth: hsm.cmac(
      vin,
      r.key_epoch,
      Buffer.from(statusAuthCanonical(r as Record<string, unknown>)),
    ),
  };
}

describe("GLEO 와이어 v2", () => {
  it("차량마다 서명된 봉투만 내보내고(v1 safe_mode 없음), 서명된 상태 보고가 끝 상태에 닿아야 CONFIRMED — 위조는 거부", async () => {
    const b = await bootApp({ at: "2026-10-12T01:00:00.000Z" });
    close = () => b.app.close();
    const http = b.http;
    const gleo = b.get(GleoAdapter);
    const hsm = b.get(HsmService);
    expect(gleo.status()).toMatchObject({
      mode: "ws",
      wire: "v2",
      connected: false,
    });
    const k = await killV2(http, {
      featureId: "FEAT-00022",
      featureVersion: "1.0.0",
      vins: ["ego-01", "lead-01"],
      reason: "GLEO v2",
      confirm: "FEAT-00022",
    });
    // 정책 배포(policy_push)는 v1 형식 그대로 — 차단만 v2 봉투
    const out = gleo.messages
      .filter(
        (m) =>
          m.dir === "out" &&
          (m.msg as { type?: string }).type === "kill_command",
      )
      .map((m) => m.msg as KillCommandV2);
    expect(
      out.map((e) => [e.type, e.schema_version, e.scope.vehicle_ids]),
    ).toEqual([
      ["kill_command", "2.0", ["ego-01"]],
      ["kill_command", "2.0", ["lead-01"]],
    ]);
    for (const env of out) {
      expect(wireErrors(KillCommandV2, env)).toEqual([]);
      expect(
        (env as unknown as Record<string, unknown>).safe_mode,
      ).toBeUndefined();
      const { signature, ...body } = env;
      expect(
        hsm.verifyDetached("kill", jcs(body), {
          alg: "EdDSA",
          kid: signature.kid,
          value: signature.value,
        }).valid,
      ).toBe(true);
    }
    // 차량 보고 — 경고(수락) → DISABLED
    out.forEach((env) =>
      gleo.onRaw(JSON.stringify(vehicleReport(hsm, env, "DEACT_WARNING", 1))),
    );
    let kd = (await http().get(`/api/kill-requests/${k.killId}`).expect(200))
      .body;
    expect(kd.delivery).toMatchObject({ confirmed: 0 });
    out.forEach((env) =>
      gleo.onRaw(JSON.stringify(vehicleReport(hsm, env, "DISABLED", 2))),
    );
    kd = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
    expect(kd.delivery).toMatchObject({
      status: "CONFIRMED",
      confirmed: 2,
      denominator: 2,
    });
    expect(
      (await http().get("/api/vehicles/ego-01/status").expect(200)).body
        .features[0],
    ).toMatchObject({ state: "DISABLED" });
    expect(
      (await http().get("/api/vehicles/ego-01/runtime").expect(200)).body
        .runtime.featureState["FEAT-00022"],
    ).toBe("DISABLED");
    // 위조 — 상태를 바꾸고 서명은 그대로 → 거부, 보안 Incident
    const forged = {
      ...vehicleReport(hsm, out[0], "DISABLED", 3),
      state: "ACTIVE",
    };
    gleo.onRaw(JSON.stringify(forged));
    const recent = (await http().get("/api/vehicles/ego-01/status").expect(200))
      .body.recent[0];
    expect(recent).toMatchObject({
      accepted: false,
      via: "GLEO",
      violation: { step: "AUTH", code: "AUTH_FAILED" },
    });
    // 모르는 가명은 버린다
    const before = (await http().get("/api/vehicles/ego-01/status").expect(200))
      .body.recent.length;
    gleo.onRaw(
      JSON.stringify({
        ...vehicleReport(hsm, out[0], "DISABLED", 4),
        vehicle_pseudonym: "0000000000000000",
      }),
    );
    expect(
      (await http().get("/api/vehicles/ego-01/status").expect(200)).body.recent
        .length,
    ).toBe(before);
    expect(gleo.status().lastError).toContain("알 수 없는 차량 가명");
  });
});
