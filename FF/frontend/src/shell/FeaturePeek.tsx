// Feature 요약 서랍 — 어느 화면에서든 IdChip의 '요약 보기'가 연다(설계안 2.1 우측 컨텍스트 서랍).
// Version이 없으면 최신 Version을 고른다. 고치는 일은 상세 화면에서 한다 — 서랍은 읽기만.
import { lazy, Suspense, useEffect, useState } from 'react';
import { AsyncView, Drawer, FEATURE_PEEK_EVENT } from '../design';

const PeekBody = lazy(() => import('./FeaturePeekBody'));

type Target = { featureId: string; version: string | null };

export function FeaturePeek() {
  const [t, setT] = useState<Target | null>(null);
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<Target>).detail);
    window.addEventListener(FEATURE_PEEK_EVENT, on);
    return () => window.removeEventListener(FEATURE_PEEK_EVENT, on);
  }, []);
  return (
    <Drawer open={!!t} title={t ? t.featureId : ''} onClose={() => setT(null)}>
      {t && <Suspense fallback={<AsyncView state="loading">{null}</AsyncView>}><PeekBody key={`${t.featureId}@${t.version ?? ''}`} featureId={t.featureId} version={t.version} onNavigate={() => setT(null)} /></Suspense>}
    </Drawer>
  );
}
