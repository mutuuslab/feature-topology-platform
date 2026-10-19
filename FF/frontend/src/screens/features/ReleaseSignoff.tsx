// Release Sign-off(출시 책임 확인) — 보고서 6.1 G7 승인자 Feature Owner의 개인 서명(사용자 결정 2026-10-18).
// VERIFIED에서 G8·G9 PASS 뒤 Feature Owner(FEATURE_AUTHOR)가 서명해야 출시 전이가 열린다. 서명은 지금의 G8·G9 판정에 묶인다.
import { useState } from 'react';
import type { ReleaseSignoffView } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { ko } from '../../copy/ko';
import { Button, Drawer, ErrorNote, Field } from '../../design';
import { usePermission } from '../shared';

const S = ko.p11.signoff;
const INVALIDATE = ['releaseSignoff', 'featureDetail', 'audit'];

export function ReleaseSignoffBar({ id, ver, gatesPassed }: { id: string; ver: string; gatesPassed: boolean }) {
  const q = useApi<ReleaseSignoffView>('releaseSignoff', { params: { id, ver } });
  const perm = usePermission(['FEATURE_AUTHOR']);
  const sign = useApiMutation('signRelease', INVALIDATE);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const v = q.data;
  const status = !v ? null : v.valid && v.signoff ? S.signed(v.signoff.signedBy, v.signoff.signedAt.slice(0, 16).replace('T', ' ')) : v.stale ? S.stale : S.none;
  return (
    <div data-testid="release-signoff" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
      {status && (
        <span className="ds-field__hint" style={{ color: v?.valid ? 'var(--ok)' : 'var(--warn)' }}>
          {status}
        </span>
      )}
      {!v?.valid && (
        <Button icon="pen" disabled={STATIC_MODE || !perm.ok || !gatesPassed} title={STATIC_MODE ? ko.page.readOnly : perm.hint ?? (gatesPassed ? undefined : S.needGates)} onClick={() => setOpen(true)} data-tour="release-signoff" data-ui="signRelease">
          {S.sign}
        </Button>
      )}
      <Drawer open={open} title={S.drawerTitle} onClose={() => setOpen(false)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p style={{ margin: 0 }}>{S.body}</p>
          <Field label={ko.page.reason}>
            <textarea className="ds-input" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={sign.error} />
          <Button
            variant="primary"
            icon="pen"
            disabled={STATIC_MODE || !perm.ok || reason.trim().length < 2 || sign.isPending}
            onClick={() => sign.mutate({ params: { id, ver }, body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) })}
          >
            {S.sign}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
