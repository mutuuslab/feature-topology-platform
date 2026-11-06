// Flag PR 뼈대(20-97 §1.3) — FF가 Feature 승인 때 차량 SW 저장소에 여는 PR의 파일 내용. 백엔드 PR 생성과 시연 생성기가 같은 결과를 쓴다.
// 상수 파일은 키 문자열의 유일한 위치이고, 호출 뼈대는 기본값 false(OFF)로 상수를 넘긴다. 스캐너 v2가 상수를 키로 푼다.
import type { ControlPointType } from '../enums';
import type { FlagPlanEntry } from '../schemas/flag-code';
import { flagConstantName, flagFeatureDir } from './flag-coverage';

/** care_00022_signal → care00022SignalEnabled */
export function flagGuardName(flagKey: string): string {
  const [head, ...rest] = flagKey.split('_');
  return head + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') + 'Enabled';
}

const ROLE: Record<ControlPointType, string> = {
  Flag: '기능 사용 허용',
  Parameter: '조정 파라미터 사용(꺼지면 기본 파라미터)',
  Signal: '신호 출력 허용',
  DTC: '고장 코드 보고 허용',
};

export interface FlagScaffoldFile {
  path: string;
  content: string;
}

/**
 * 한 Feature의 Flag 계획 전체로 상수·호출 뼈대 파일을 만든다(같은 Feature의 새 Version은 같은 파일을 덮어쓴다).
 * 줄 끝은 LF, 키 순서는 계획 순서. runtime 패키지의 FlagClient(OpenFeature 형태)를 상대 경로로 가져온다.
 */
export function flagScaffoldFiles(feature: { featureId: string; version: string; name: string }, plan: readonly FlagPlanEntry[]): FlagScaffoldFile[] {
  if (plan.length === 0) return [];
  const pkg = plan[0].package;
  if (plan.some((p) => p.package !== pkg || p.featureId !== feature.featureId)) throw new Error('한 Feature·한 패키지의 계획만 받습니다.');
  const dir = flagFeatureDir(pkg, feature.featureId);
  const consts = plan.map((p) => flagConstantName(p.flagKey));
  const listName = `${feature.featureId.replace('-', '_')}_FLAGS`;
  const flags = [
    `// FF가 만든 Flag 상수 — ${feature.featureId} ${feature.version} 「${feature.name}」. 키 문자열은 FF 등록 원장과 대사하므로 바꾸지 않는다.`,
    ...plan.map((p) => `export const ${flagConstantName(p.flagKey)} = '${p.flagKey}' as const;`),
    `export const ${listName} = [${consts.join(', ')}] as const;`,
    '',
  ].join('\n');
  const guards = [
    '// FF가 만든 호출 뼈대 — 기본값 OFF(false). 기능 코드는 이 함수로만 Flag를 읽는다.',
    "import type { FlagClient, FlagContext } from '../../../../runtime/src/flag-client.ts';",
    `import { ${consts.join(', ')} } from './flags.ts';`,
    '',
    ...plan.flatMap((p) => [
      `/** ${p.controlPoint} 제어점 — ${ROLE[p.controlPoint]} */`,
      `export function ${flagGuardName(p.flagKey)}(client: FlagClient, ctx: FlagContext): Promise<boolean> {`,
      `  return client.getBooleanValue(${flagConstantName(p.flagKey)}, false, ctx);`,
      '}',
      '',
    ]),
  ].join('\n');
  return [
    { path: `${dir}/flags.ts`, content: flags },
    { path: `${dir}/flag-guards.ts`, content: guards },
  ];
}

/** Flag PR 제목·본문 — 본문에는 FF 화면 경로만 싣고 토큰·내부 ID를 넣지 않는다 */
export function flagPrText(kind: 'SCAFFOLD' | 'REMOVAL', feature: { featureId: string; version: string; name: string }, flagKeys: readonly string[], ffBaseUrl: string) {
  const list = flagKeys.map((k) => `- \`${k}\` — ${ffBaseUrl}/flag-code/flags/${k}`).join('\n');
  return kind === 'SCAFFOLD'
    ? { title: `[FF] ${feature.featureId} ${feature.version} Flag 상수·호출 뼈대`, body: `「${feature.name}」 승인으로 등록된 Flag입니다. 기본값은 OFF입니다. 기능 분기를 구현한 뒤 병합하세요.\n\n${list}\n` }
    : { title: `[FF] Flag 제거 — ${flagKeys.join(', ')}`, body: `Retirement가 승인된 Flag의 호출을 지웁니다. 최종 값으로 고정한 분기만 남깁니다.\n\n${list}\n` };
}
