// 이전 주소(BDC 데모 화면) → v2 화면. 데모 화면 코드는 지웠고, 남은 링크·북마크는 대응하는 v2 화면으로 보낸다(:param은 그대로 옮긴다).
import type { ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';

export function legacyTo(target: string): ComponentType {
  function LegacyRedirect() {
    const params = useParams();
    return <Navigate to={target.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))} replace />;
  }
  return LegacyRedirect;
}
