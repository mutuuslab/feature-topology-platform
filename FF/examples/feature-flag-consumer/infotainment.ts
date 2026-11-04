// 가상 차량 앱: 플랫폼의 IVI 정책 네 키가 실제 소비 코드에서 어떻게 쓰이는지 보여 준다.
import type { FlagClient } from './distance.ts';

export async function infotainmentDecision(client: FlagClient, vin: string): Promise<{ detail: boolean; banner: boolean; voice: boolean; guide: boolean }> {
  const context = { targetingKey: vin };
  const detail = await client.getBooleanValue('ivi_00027_detail', false, context);
  const banner = await client.getBooleanValue('ivi_00027_banner', false, context);
  const voice = await client.getBooleanValue('ivi_00027_voice', false, context);
  const guide = await client.getBooleanValue('ivi_00024_guide', false, context);
  return { detail, banner, voice, guide };
}
