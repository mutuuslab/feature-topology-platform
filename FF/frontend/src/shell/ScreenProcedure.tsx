// 이 화면의 업무 절차 패널 — 현재 화면 경로를 쓰는 활동을 보여 준다. 내 역할(수행·책임) 활동이 먼저.
// Shell이 지연 로딩한다(업무 절차 데이터는 첫 화면 번들에 넣지 않는다).
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { activitiesForScreen, raciOf } from '@ff/contracts';
import { procedures as P } from '../copy/procedures';
import { useWorkflows } from '../data/workflows';
import { Button, Drawer } from '../design';
import { ActivityBody, RaciBadge } from '../screens/procedures/ActivityView';
import { routeOf } from '../routes';
import { useAppShell } from '../store';
import { procedureGuideStore } from './procedureGuide';

export default function ScreenProcedure({ onClose }: { onClose: () => void }) {
  const loc = useLocation();
  const { role } = useAppShell();
  const doc = useWorkflows();
  const pattern = routeOf(loc.pathname)?.path ?? loc.pathname;
  const roleIds = doc && doc !== 'fail' ? (doc.personas[role] ?? []) : [];
  const weight = (k: string | null) => (k === 'R' || k === 'A' ? 0 : 1);
  const list =
    doc && doc !== 'fail'
      ? activitiesForScreen(doc, pattern)
          .map((x) => ({ ...x, k: raciOf(x.activity, roleIds) }))
          .sort((a, b) => weight(a.k) - weight(b.k))
      : [];
  return (
    <Drawer open title={P.panel.title} onClose={onClose}>
      {doc === null && <p className="ds-field__hint">{P.loading}</p>}
      {doc === 'fail' && <p className="ds-stale">{P.loadFail}</p>}
      {doc && doc !== 'fail' && list.length === 0 && <p className="ds-field__hint">{P.panel.none}</p>}
      {list.length > 0 && <p className="ds-field__hint">{P.panel.mineFirst}</p>}
      {doc && doc !== 'fail' &&
        list.map(({ process, activity: a, k }) => (
          <section key={a.id} className="pr-panel-item" aria-label={a.name}>
            <h3>
              {a.name} <RaciBadge k={k} />
            </h3>
            <p className="ds-field__hint">
              {process.name} · <Link to={`/procedures/${process.id}?a=${a.id}`} onClick={onClose}>{P.panel.openProcess}</Link>
            </p>
            {a.platform.anchor && (
              <Button
                icon="target"
                aria-label={`${a.name} ${P.guide.eyebrow}`}
                onClick={() => {
                  onClose();
                  procedureGuideStore.open(a.id, process.id);
                }}
              >
                {P.guide.eyebrow}
              </Button>
            )}
            <ActivityBody doc={doc} a={a} />
          </section>
        ))}
    </Drawer>
  );
}
