// Data Lake 가명 단위 삭제 — FF가 부르는 접점(80-75 §7 "가명 단위 삭제", IF-15 `POST /v1/erasure`). 출시 준비 RD-P2-05.
// Lake 서버는 아직 없다(설계만). 설정(FF_LAKE_URL·FF_LAKE_TOKEN)이 있으면 그 주소로 보내고, 없으면 NOT_CONNECTED로 요청 기록에 남긴다 —
// Lake를 연결하면 남은 요청을 다시 보내는 것이 다음 단계다(80-75 10장 M-단계). 차량 가명은 FF·차량·Lake가 같은 규칙(sha256("ffp-pseudonym|"+VIN) 앞 16자).
import { Injectable, Logger } from '@nestjs/common';
import type { ErasureBasis, ErasureResult } from '@ff/contracts';

type Env = Record<string, string | undefined>;

export interface LakeErasureConfig {
  url: string;
  token: string;
  timeoutMs: number;
}

/** 설정 — 주소와 토큰(lake.ingest 범위)이 둘 다 있을 때만. 운영 모드 형식 검사는 runtime-config(https·토큰) */
export function lakeErasureConfig(env: Env = process.env): LakeErasureConfig | null {
  const url = env.FF_LAKE_URL?.trim();
  const token = env.FF_LAKE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token, timeoutMs: Math.max(1000, Number(env.FF_LAKE_TIMEOUT_MS) || 10_000) };
}

/** IF-15 ErasureRequest.basis — 사용자 퇴직(EMPLOYMENT_END)은 차량 자료 근거가 아니다 */
const LAKE_BASIS: Partial<Record<ErasureBasis, string>> = { DATA_SUBJECT_REQUEST: 'DATA_SUBJECT_REQUEST', CONSENT_WITHDRAWN: 'CONSENT_WITHDRAWN', CONTRACT_END: 'CONTRACT_END' };

@Injectable()
export class LakeErasureClient {
  private readonly log = new Logger('LakeErasure');

  /** 가명 단위 삭제 요청 — 202면 SENT(Lake 요청 ID), 연결 설정이 없으면 NOT_CONNECTED, 그 밖은 FAILED(사유) */
  async request(body: { requestRef: string; pseudonyms: string[]; basis: ErasureBasis }, env: Env = process.env): Promise<ErasureResult['lake']> {
    const cfg = lakeErasureConfig(env);
    if (!cfg) return { status: 'NOT_CONNECTED', lakeRequestId: null, detail: 'Data Lake 연결 설정(FF_LAKE_URL·FF_LAKE_TOKEN)이 없어 보내지 않았습니다 — 연결하면 이 요청을 다시 보냅니다' };
    const basis = LAKE_BASIS[body.basis];
    if (!basis) return { status: 'FAILED', lakeRequestId: null, detail: `Data Lake 삭제 근거가 아닙니다: ${body.basis}` };
    try {
      const res = await fetch(`${cfg.url}/v1/erasure`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ request_ref: body.requestRef, pseudonyms: body.pseudonyms, basis }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      const text = await res.text();
      if (res.status !== 202 && res.status !== 200) return { status: 'FAILED', lakeRequestId: null, detail: `Data Lake가 ${res.status}로 답했습니다` };
      let id: string | null = null;
      try {
        id = (JSON.parse(text) as { request_id?: string }).request_id ?? null;
      } catch {
        id = null;
      }
      return { status: 'SENT', lakeRequestId: id, detail: null };
    } catch (e) {
      this.log.warn(`Data Lake 삭제 요청 실패: ${(e as Error).message}`);
      return { status: 'FAILED', lakeRequestId: null, detail: `Data Lake에 보내지 못했습니다: ${(e as Error).name}` };
    }
  }
}

/** 설정 검사(runtime-config) — 주소·토큰은 함께, 운영 모드는 https만(사내망 TLS, 80-75 §5) */
export function lakeErasureConfigProblems(env: Env, production: boolean): string[] {
  const url = env.FF_LAKE_URL?.trim();
  const token = env.FF_LAKE_TOKEN?.trim();
  const out: string[] = [];
  if (!!url !== !!token) out.push('FF_LAKE_URL과 FF_LAKE_TOKEN은 함께 설정합니다 — Data Lake 가명 단위 삭제 요청(IF-15)');
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) out.push(`FF_LAKE_URL '${url}' — http(s) 주소여야 합니다`);
  else if (url && production && !url.startsWith('https://')) out.push('FF_LAKE_URL — 운영 모드는 https 주소만(사내망 TLS)');
  return out;
}
