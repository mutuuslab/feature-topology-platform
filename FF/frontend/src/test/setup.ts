import '@testing-library/jest-dom';

/**
 * jsdom 에는 2D 캔버스가 없어 `getContext()` 호출마다 "Not implemented" 스택 트레이스를 console 로
 * 쏟아낸다. 라벨 텍스처(`scene/labels.tsx`)는 null 을 전제로 이미 방어하고 있어(jsdom 에서는 라벨을
 * 건너뛴다) 동작은 그대로 두고 경고만 없앤다.
 */
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

/**
 * R3F 인트린식(`<boxGeometry />` 등)을 jsdom(React DOM)이 렌더할 때 React 가 "잘못된 대소문자"
 * 경고를 요소마다 컴포넌트 스택과 함께 찍는다. 3D 화면 스모크는 프레임당 수천 개를 만들어
 * 전체 스위트 로그가 회차당 39 MB 에 달했고, 그 출력을 워커→메인 RPC 로 전송하다
 * "Timeout calling onTaskUpdate" 가 발생해 **파일 하나의 결과가 통째로 유실**됐다(18 파일 중
 * 17 파일만 집계). 경고 1종만 걸러 스위트가 실제 결과를 보고하도록 복구한다.
 */
const realConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('is using incorrect casing')) return;
  realConsoleError(...args);
};

