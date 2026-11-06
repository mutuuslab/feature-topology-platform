// Release Sign-off(출시 책임 확인) — 보고서 6.1 G7 승인자 Feature Owner의 개인 서명(사용자 결정 2026-10-18).
// VERIFIED에서 G8·G9 PASS 뒤 Feature Owner(FEATURE_AUTHOR)가 서명해야 출시 전이가 열린다. 서명은 지금의 G8·G9 판정에 묶인다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReleaseSignoffView } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { Button, Drawer, ErrorNote, Field, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { featureRefsTab } from '../../copy/propose';
import { RefWarningList, type RefWarning } from '../refdb/common';
import { localTime, personLabel } from '../../data/people';
import { signoffEvidence as SE } from '../../copy/inbox';

const S = ko.p11.signoff;
const INVALIDATE = ['releaseSignoff', 'featureDetail', 'audit'];

export function ReleaseSignoffBar({ id, ver, gatesPassed }: { id: string; ver: string; gatesPassed: boolean }) {
  const q = useApi<ReleaseSignoffView>('releaseSignoff', { params: { id, ver } });
  const perm = usePermission(['FEATURE_AUTHOR']);
  const sign = useApiMutation<{ warnings?: RefWarning[] }>('signRelease', INVALIDATE);
  const [open, setOpen] = useState(false);
  // 폐기 예정·폐기 기준 행이 연결돼 있어도 서명은 된다 — 서버 안내(warnings)를 남겨 다음 Version에서 고치게 한다(사용자 결정 2026-11-04 #9)
  const [warnings, setWarnings] = useState<RefWarning[]>([]);
  const [reason, setReason] = useState('');
  const v = q.data;
  // 서명자는 이름·소속, 시각은 한국 시각 — 감사 탭과 같은 표기(UTC·계정 ID로 보이던 결함, P1-5)
  const status = !v ? null : v.valid && v.signoff ? S.signed(personLabel(v.signoff.signedBy), localTime(v.signoff.signedAt)) : v.stale ? S.stale : S.none;
  return (
    <div data-testid="release-signoff" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
      {status && (
        <span className="ds-field__hint" style={{ color: v?.valid ? 'var(--ok)' : 'var(--warn)' }}>
          {status}
        </span>
      )}
      {!v?.valid && (
        <Button icon="pen" disabled={!perm.ok || !gatesPassed} title={perm.hint ?? (gatesPassed ? undefined : S.needGates)} onClick={() => setOpen(true)} data-tour="release-signoff" data-ui="signRelease">
          {S.sign}
        </Button>
      )}
      <RefWarningList warnings={warnings} title={featureRefsTab.warnSignoff} />
      <Drawer open={open} title={S.drawerTitle} onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p style={{ margin: 0 }}>{S.body}</p>
          {/* 근거 — 서명하기 전에 G8·G9 판정과 안전 분류(Safety Case)를 열어 본다 */}
          <p style={{ margin: 0, display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }} data-signoff-evidence>
            <Link to={`/features/${id}/${ver}?tab=gates`}>{SE.gates}</Link>
            <Link to={`/features/${id}/${ver}?tab=safety`}>{SE.safety}</Link>
            <Link to={`/verify/evidence?feature=${id}`}>{SE.evidence}</Link>
          </p>
          <Field label={ko.page.reason}>
            <textarea className="ds-input" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={sign.error} />
          <Button
            variant="primary"
            icon="pen"
            disabled={!perm.ok || reason.trim().length < 2 || sign.isPending}
            reason={whyDisabled([!perm.ok, perm.hint], [reason.trim().length < 2, ko.why.reason])}
            onClick={() => sign.mutate({ params: { id, ver }, body: { reason } }, { onSuccess: (r) => (setOpen(false), setReason(''), setWarnings(r?.warnings ?? [])) })}
          >
            {S.sign}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
