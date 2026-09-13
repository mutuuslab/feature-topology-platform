/**
 * §17.2 — 3D 장면용 오프라인 텍스트 라벨.
 *
 * RFTwin `scene/Label.tsx` 의 tier/LOD/충돌 회피 설계를 이식했다(외부 폰트·CDN 미사용,
 * CanvasTexture sprite 만 사용). 요약:
 *  - tier 0: 셀 사인·존 사인·Andon·AMR ID 등 항상 참여.
 *  - tier 1: 설비 태그(스테이션 ID·랙·함체). tier 2: 근거리 상세.
 *  - 모드 Auto / All / Alerts / Off. Auto 는 거리로 tier 를 잘라낸다.
 *  - tier ≥1 은 "고정 화면 픽셀" 라벨: 매 회차 거리 기반으로 월드 스케일을 재계산하고
 *    상·하한으로 클램프해 원근에서도 읽힌다. 동시 표시 ≤ 20(All ≤ 60).
 *  - 화면 공간 greedy 충돌 회피로 우선순위(상태 > 선택 > 근접) 높은 라벨만 남긴다.
 *  - depthTest 유지 → 설비/벽에 가리면 자연히 사라진다.
 *
 * jsdom 에는 2D 캔버스가 없으므로 `makeTexture` 가 null 을 돌려주고 `Label` 은 아무것도
 * 렌더하지 않는다(테스트에서 assert 대상은 HUD/2D 도면 쪽이다).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function makeTexture(text: string, color: string): THREE.CanvasTexture | null {
  const key = `${color}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  const ctx = c.getContext?.('2d');
  // jsdom(2D 컨텍스트 없음) 또는 2D API 가 없는 스텁 컨텍스트면 라벨을 그리지 않는다.
  if (!ctx || typeof ctx.measureText !== 'function') return null;
  const font = "600 34px system-ui, 'Segoe UI', 'Malgun Gothic', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = Math.max(2, w);
  c.height = 48;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 8, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 2;
  cache.set(key, tex);
  if (cache.size > 400) cache.clear();
  return tex;
}

type Entry = {
  ref: React.RefObject<THREE.Sprite | null>;
  tier: number;
  priority: number;
  scene: THREE.Scene;
  aspect: number;
};
const registry = new Set<Entry>();

export type LabelsMode = 'auto' | 'all' | 'alerts' | 'off';

/** LOD 임계값과 예산. RFTwin 과 동일한 값을 유지한다. */
export const LOD = {
  far: 52,
  mid: 26,
  minPx: 8,
  px: [0, 15, 12] as const,
  maxDynamic: 20,
  maxDynamicAll: 60,
  intervalSec: 0.15,
};

export function Label({
  text,
  position,
  color = '#c9d3e4',
  size = 1,
  tier = 1,
  priority,
}: {
  text: string;
  position: [number, number, number];
  color?: string;
  size?: number;
  tier?: 0 | 1 | 2;
  priority?: number;
}) {
  const tex = useMemo(() => makeTexture(text, color), [text, color]);
  const ref = useRef<THREE.Sprite>(null);
  const scene = useThree((s: { scene: THREE.Scene }) => s.scene);

  useEffect(() => {
    if (!tex || !scene) return;
    const e: Entry = { ref, tier, priority: priority ?? 3 - tier, scene, aspect: tex.image.width / tex.image.height };
    registry.add(e);
    return () => {
      registry.delete(e);
    };
  }, [tex, tier, priority, scene]);

  if (!tex) return null;
  const aspect = tex.image.width / tex.image.height;
  return (
    <sprite ref={ref} position={position} scale={[size * aspect * 0.5, size * 0.5, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

/** 메인 `<Canvas>` 안에 한 번만 둔다. 라벨 크기/가시성을 150 ms 주기로 재계산한다. */
export function LabelManager({ mode }: { mode: LabelsMode }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const size = useThree((s: { size: { width: number; height: number } }) => s.size);
  const acc = useRef(999);
  const v = useMemo(() => new THREE.Vector3(), []);
  const ref = useRef<LabelsMode>(mode);
  ref.current = mode;

  useFrame((_, dt) => {
    if (!camera || !scene || !size) return;
    acc.current += dt;
    if (acc.current < LOD.intervalSec) return;
    acc.current = 0;
    const m = ref.current;
    const items: { e: Entry; s: THREE.Sprite; rect: [number, number, number, number]; key: number }[] = [];
    const tanH = Math.tan((camera.fov * Math.PI) / 360);

    for (const e of registry) {
      if (e.scene !== scene) continue;
      const s = e.ref.current;
      if (!s) continue;
      if (m === 'off') {
        s.visible = false;
        continue;
      }
      s.getWorldPosition(v);
      const dist = v.distanceTo(camera.position);
      if (m === 'auto') {
        const maxTier = dist > LOD.far ? 0 : dist > LOD.mid ? 1 : 2;
        if (e.tier > maxTier) {
          s.visible = false;
          continue;
        }
      } else if (m === 'alerts' && e.tier > 0 && e.priority < 8) {
        s.visible = false;
        continue;
      }
      const p = v.clone().project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.15 || Math.abs(p.y) > 1.15) {
        s.visible = false;
        continue;
      }
      if (e.tier > 0) {
        const worldH = Math.min(2.4, Math.max(0.3, (LOD.px[e.tier] * 2 * dist * tanH) / size.height));
        s.scale.set(worldH * e.aspect, worldH, 1);
      }
      const pxH = (s.scale.y * size.height) / (2 * dist * tanH);
      if (pxH < LOD.minPx && e.tier > 0 && m !== 'all') {
        s.visible = false;
        continue;
      }
      const pxW = pxH * (s.scale.x / s.scale.y);
      const cx = ((p.x + 1) / 2) * size.width;
      const cy = ((1 - p.y) / 2) * size.height;
      items.push({
        e,
        s,
        rect: [cx - pxW / 2, cy - pxH / 2, cx + pxW / 2, cy + pxH / 2],
        key: e.priority * 10000 - dist,
      });
    }

    items.sort((a, b) => b.key - a.key);
    const kept: [number, number, number, number][] = [];
    const cap = m === 'all' ? LOD.maxDynamicAll : LOD.maxDynamic;
    let dyn = 0;
    for (const it of items) {
      if (it.e.tier > 0 && dyn >= cap) {
        it.s.visible = false;
        continue;
      }
      const r = it.rect;
      const hit = kept.some((k) => !(r[2] < k[0] || r[0] > k[2] || r[3] < k[1] || r[1] > k[3]));
      it.s.visible = !hit;
      if (!hit) {
        kept.push(r);
        if (it.e.tier > 0) dyn++;
      }
    }
  });
  return null;
}

/** 장면이 사라질 때 registry 누수를 막는다(테스트에서 반복 mount 되는 경우 대비). */
export function resetLabelRegistry(): void {
  registry.clear();
}
