/**
 * §18.11 — WebGL 사용 가능 여부. 3D 씬을 쓰는 화면이 여럿이라 한 곳에 모은다.
 *
 * jsdom 처럼 WebGL 을 구현하지 않는 환경에서 `getContext` 를 호출하면 콘솔에
 * "Not implemented" 경고가 쏟아지므로 생성자 존재 여부를 먼저 본다.
 */
export function webglSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!('WebGLRenderingContext' in window)) return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default webglSupported;
