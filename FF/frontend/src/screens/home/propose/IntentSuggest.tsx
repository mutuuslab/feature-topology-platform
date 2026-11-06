// ① 이름·설명으로 찾기(20-60 §5.3) — 만들 기능을 한 줄로 적으면 기준 행 후보를 추천한다(기능명·별칭·사내 용어·단어 겹침).
// 실서버는 GET /api/ple/ref-suggestions, 공개 데모는 받아 둔 기준 행 목록으로 같은 규칙(contracts suggestRefsFromText)을 돌린다.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { suggestRefsFromText, type PleRef, type RefSuggestion } from '@ff/contracts';
import { STATIC_MODE } from '../../../api/client';
import { useApi } from '../../../api/hooks';
import { autofill as A } from '../../../copy/ple';
import { Button, Field } from '../../../design';
import { loadAll } from '../../refdb/refSearch';
import type { RefLite } from './prefill';
import '../../ple/ple.css';

function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function IntentSuggest({ pickedIds, onPick }: { pickedIds: ReadonlySet<string>; onPick: (ref: RefLite) => void }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const live = useApi<{ items: RefSuggestion[] }>('refSuggestions', { query: { q } }, { enabled: !STATIC_MODE && q.length >= 2 });
  // 공개 데모 — 받아 둔 전체 목록 한 쪽에서 같은 규칙으로
  const all = useQuery<PleRef[]>({ queryKey: ['listRefs', 'explorer-all'], queryFn: ({ signal }) => loadAll<PleRef>(signal), enabled: STATIC_MODE && q.length >= 2, staleTime: Infinity });
  const items: RefSuggestion[] = STATIC_MODE ? (q.length >= 2 ? suggestRefsFromText(q, all.data ?? []) : []) : (live.data?.items ?? []);
  const busy = q.length >= 2 && (STATIC_MODE ? all.isPending : live.isPending);
  return (
    <section className="intent" aria-labelledby="intent-h" data-testid="intent-suggest">
      <h3 id="intent-h" style={{ margin: 0 }}>
        {A.intentTitle}
      </h3>
      <Field label={A.intentLabel} hint={A.intentHint}>
        <input className="ds-input" name="intent" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </Field>
      <div aria-live="polite" aria-busy={busy}>
        {q.length < 2 ? (
          <p className="ds-field__hint">{A.intentEmpty}</p>
        ) : busy ? null : items.length ? (
          <ol className="intent__list" data-testid="intent-results">
            {items.map((s) => {
              const picked = pickedIds.has(s.refId);
              return (
                <li key={s.refId} className="intent__row" data-intent-ref={s.refId}>
                  <span>
                    <span className="ds-mono">{s.refId}</span> <span className="intent__name">{s.nameKo}</span> <span className="ds-tag">{s.component}</span> <span className="ds-tag">ASIL {s.asilRep}</span>
                    <span className="intent__why">
                      {s.reasons.map((r) => (
                        <span key={r} className="ds-tag">
                          {r}
                        </span>
                      ))}
                      <span className="ds-tag">{A.score(s.score)}</span>
                    </span>
                  </span>
                  <Button variant={picked ? 'default' : 'primary'} disabled={picked} aria-label={A.intentPick(s.refId)} onClick={() => onPick(s.ref as RefLite)}>
                    {picked ? A.intentPicked : A.intentPick(s.refId)}
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="ds-field__hint">{A.intentNone}</p>
        )}
      </div>
    </section>
  );
}
