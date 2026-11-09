// 일괄 명령 미리보기(ADS-UI03) — 긴급 차단 요청·롤백·정책 배포 Drawer에 넣는 BulkPreview 어댑터.
// 기존 미리보기 응답(GET /api/kill-requests/preview, POST /api/rollbacks/preview)을 쓰고, 서명 대상 digest(targetDigest·serverDigest)는
// 서버 대상 검증(결함 ADS-BE05, 다른 작업)이 채우는 선택 필드다 — 없으면 '서명 대상 digest는 서버 대상 검증 뒤 표시'.
// 형상·연결을 모르는 차량(unknownVins)은 '대상 판단 불가 N대'로 따로, '제외하고 진행'을 직접 고른다. Drawer 머리 문장은 핵심 메시지가 아니다(data-key-message 없음).
import type { BulkTargetDigestFields, DeactClass, FClass } from '@ff/contracts';
import { useApi } from '../../api/hooks';
import { adsChange } from '../../copy/ads-change';
import { ClassBadges } from '../../design';
import { BulkPreview } from '../../design/ads';
import './ads-change.css';

const K = adsChange.bulk;

/** Drawer 머리 문장 — 서명 대상 N대 — 제외 M대 */
function Head({ targets, excluded }: { targets: number; excluded: number }) {
  return <p className="adc-path__state">{K.head(targets, excluded)}</p>;
}

const NoPermission = () => <p className="adc-note">{K.noPermission}</p>;

interface KillPreviewLike extends BulkTargetDigestFields {
  vehicles: { vin: string; link: string }[];
  unknownVins?: string[];
  registry: { f_class: FClass; deact_class: DeactClass } | null;
}

/** 긴급 차단 요청 Drawer — 고른 차량·직접 뺀 차량·대상 판단 불가·종료 사건 단위 해제 범위·F등급·DC */
export function KillBulkPreview({ p, vins, canSign, onExcludeUnknown }: { p: KillPreviewLike; vins: string[]; canSign: boolean; onExcludeUnknown: (v: boolean) => void }) {
  const dropped = p.vehicles.length - vins.length;
  const excluded = dropped > 0 ? [{ reason: K.operatorExcluded, count: dropped }] : [];
  return (
    <div className="adc-stack" data-bulk="kill">
      <Head targets={vins.length} excluded={dropped > 0 ? dropped : 0} />
      <BulkPreview
        spec={{
          targets: vins.length,
          excluded,
          undecidable: p.unknownVins?.length ?? 0,
          scope: K.killScope(vins.length),
          risk: p.registry ? <ClassBadges f={p.registry.f_class} dc={p.registry.deact_class} /> : undefined,
          digest: p.targetDigest ?? null,
          serverDigest: p.serverDigest ?? null,
        }}
        action={canSign ? undefined : <NoPermission />}
        onExcludeUnknown={onExcludeUnknown}
      />
    </div>
  );
}

interface RollbackPreviewLike extends BulkTargetDigestFields {
  vins: string[];
}

/** 롤백 미리보기 — 고른 범위 안 차량, 직접 적은 VIN 중 범위 밖은 제외 사유로 */
export function RollbackBulkPreview({ p, requested, recovery, canSign }: { p: RollbackPreviewLike; requested: string[]; recovery: string; canSign: boolean }) {
  const outside = requested.filter((v) => !p.vins.includes(v)).length;
  return (
    <div className="adc-stack" data-bulk="rollback">
      <Head targets={p.vins.length} excluded={outside} />
      <BulkPreview
        spec={{
          targets: p.vins.length,
          excluded: outside ? [{ reason: K.outOfScope, count: outside }] : [],
          undecidable: 0,
          scope: K.rollbackScope(recovery),
          digest: p.targetDigest ?? null,
          serverDigest: p.serverDigest ?? null,
        }}
        action={canSign ? undefined : <NoPermission />}
      />
    </div>
  );
}

/** 정책 배포 Drawer — Feature 적용 범위 차량(긴급 차단 미리보기와 같은 범위 계산)·F등급·DC */
export type PolicyDeployPreviewData = KillPreviewLike;
export function PolicyDeployPreview({ preview: p, canSign }: { preview: PolicyDeployPreviewData; canSign: boolean }) {
  const offline = p.vehicles.filter((v) => v.link === 'OFFLINE').length;
  return (
    <div className="adc-stack" data-bulk="deploy">
      <Head targets={p.vehicles.length} excluded={0} />
      <BulkPreview
        spec={{
          targets: p.vehicles.length,
          excluded: [],
          undecidable: p.unknownVins?.length ?? 0,
          scope: offline ? `${K.deployScope} · ${K.offline(offline)}` : K.deployScope,
          risk: p.registry ? <ClassBadges f={p.registry.f_class} dc={p.registry.deact_class} /> : undefined,
          digest: p.targetDigest ?? null,
          serverDigest: p.serverDigest ?? null,
        }}
        action={canSign ? undefined : <NoPermission />}
      />
    </div>
  );
}
