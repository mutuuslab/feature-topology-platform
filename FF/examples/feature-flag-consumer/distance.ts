// 실제 소비 코드 예제. Provider는 FF 인증·서명 경계 안에서 구성하고 연결 실패 시 false를 반환해야 한다.
export interface FlagClient {
  getBooleanValue(key: string, fallback: false, context: { targetingKey: string }): Promise<boolean>;
}

export async function distanceDecision(client: FlagClient, vin: string, gapMetres: number) {
  const context = { targetingKey: vin };
  const signal = await client.getBooleanValue('care_00022_signal', false, context);
  if (!signal) return { mode: 'BASE_CONTROL' as const, warning: false, parameterEnabled: false };
  const parameter = await client.getBooleanValue('care_00022_param', false, context);
  return { mode: 'FEATURE' as const, warning: gapMetres < 20, parameterEnabled: parameter };
}
