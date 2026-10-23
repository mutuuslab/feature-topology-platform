// OF-2·OF-3 — 공식 OpenFeature 웹 SDK(@openfeature/web-sdk) + OFREP 웹 provider가 FF에 붙어 받은 값.
// 정적 문맥(차량 VIN = targetingKey)으로 bulk 평가를 받아 두고, ETag 폴링으로 차단·배포 변경을 감지하면 PROVIDER_CONFIGURATION_CHANGED를 낸다.
// 화면은 SDK가 앱에 준 값·사유·flagMetadata를 서버 판단과 나란히 보여 준다 — 둘이 다르면 연계 결함이다.
// 단, F2 이상 flag는 OpenFeature 경계 밖이다(FFG-OFT-001): SDK는 Safe Default + DISABLED만 받고 값은 차량 Safety Guard가 정한다 — 불일치가 아니다.
import { useEffect, useState } from 'react';
import { OpenFeature, ProviderEvents, type EvaluationDetails, type FlagValue } from '@openfeature/web-sdk';
import { OFREPWebProvider } from '@openfeature/ofrep-web-provider';
import { STATIC_MODE } from '../../api/client';
import { ko } from '../../copy/ko';
import { KeyValue, Panel, RuleText, VerdictBadge } from '../../design';
import { OpenFeatureScopeLink } from '../ext/OpenFeatureScope';

const O = ko.openfeature;
const DOMAIN = 'ff-console';
let ready: Promise<void> | null = null;

/** provider는 앱 전체에서 한 번 — 폴링 간격은 시연에서 변경이 바로 보이도록 3초 */
function provider(pollInterval: number) {
  ready ??= OpenFeature.setProviderAndWait(DOMAIN, new OFREPWebProvider({ baseUrl: window.location.origin, pollInterval, changeDetection: 'polling', cacheMode: 'disabled' }), { targetingKey: 'ego-01' });
  return ready;
}

export function OpenFeaturePanel({ vin, flagKey, serverValue, pollInterval = 3000 }: { vin: string; flagKey: string; serverValue: boolean | null; pollInterval?: number }) {
  const [details, setDetails] = useState<EvaluationDetails<FlagValue> | null>(null);
  const [log, setLog] = useState<{ at: string; type: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (STATIC_MODE) return;
    let alive = true;
    const client = OpenFeature.getClient(DOMAIN);
    const read = (type: string) => {
      if (!alive) return;
      setDetails(client.getBooleanDetails(flagKey, false));
      setLog((xs) => [...xs.slice(-4), { at: new Date().toISOString().slice(11, 19), type }]);
    };
    const onReady = () => read(O.ready);
    const onChanged = () => read(O.changed);
    client.addHandler(ProviderEvents.ConfigurationChanged, onChanged);
    provider(pollInterval)
      .then(() => OpenFeature.setContext(DOMAIN, { targetingKey: vin }))
      .then(onReady, (e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      client.removeHandler(ProviderEvents.ConfigurationChanged, onChanged);
    };
  }, [vin, flagKey, pollInterval]);

  if (STATIC_MODE)
    return (
      <Panel title={O.title} id="openfeature">
        <p className="ds-field__hint">{O.staticNote}</p>
      </Panel>
    );
  // 경계 밖 — 단일 평가는 DISABLED(decided_by), 웹 SDK는 bulk에서 F2 이상 키가 빠져(FFG-OFT-005) 서버에 배포됐는데도 FLAG_NOT_FOUND
  const guarded = (details?.reason === 'DISABLED' && details.flagMetadata?.decided_by === 'vehicle_safety_guard') || (details?.errorCode === 'FLAG_NOT_FOUND' && serverValue !== null);
  const agree = details && serverValue !== null && !guarded ? details.value === serverValue : null;
  return (
    <Panel title={O.title} eyebrow={`OFREP · targetingKey=${vin}`} id="openfeature" actions={agree === null ? <OpenFeatureScopeLink /> : <VerdictBadge value={agree ? 'PASS' : 'FAIL'} />}>
      <p className="ds-field__hint">{O.lead}</p>
      {guarded && (
        <p className="ds-stale" role="note" data-testid="of-guarded">
          <RuleText text={ko.p10.openfeature.guarded} explain />
        </p>
      )}
      {error && <p className="ds-stale">{error}</p>}
      {details && (
        <KeyValue
          rows={[
            { k: O.value, v: <strong className="ds-mono" data-testid="of-value">{details.value ? 'ON' : 'OFF'}</strong> },
            { k: O.reason, v: <span className="ds-mono">{`${details.reason ?? '—'}${details.errorCode ? ` · ${details.errorCode}` : ''}`}</span> },
            { k: O.variant, v: <span className="ds-mono">{details.variant ?? '—'}</span> },
            { k: O.metadata, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{Object.entries(details.flagMetadata ?? {}).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}</span> },
            { k: O.events, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{log.map((l) => `${l.at} ${l.type}`).join(' · ')}</span> },
          ]}
        />
      )}
    </Panel>
  );
}
