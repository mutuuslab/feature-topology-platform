import { useApi } from '../api/hooks';
import { DEMO_EXTRAS } from '../auth-mode';
import { externalLaunch as T } from '../copy/external';
import { Icon } from '../design/icons';
import { useAppShell } from '../store';
import { externalReferenceUrl, externalUrl, GITHUB_PR_URL, isDemoReference, openExternalWindow, type ExternalSystem } from './links';
import { grafanaLinks } from './grafana';
import './launchers.css';

type Ref = { system: string; key: string; url: string };
type Source = { url: string; repository: string; commit: string };

export function ExternalToolLaunchers({ requirement, jira, featureId, version, compact = false }: { requirement?: Ref; jira?: Ref; featureId?: string; version?: string; compact?: boolean }) {
  const { role } = useAppShell();
  const flags = useApi<{ sources: Source[] }[]>('featureFlags', { query: { featureId, version } });
  const source = Array.isArray(flags.data) ? flags.data.flatMap((r) => r.sources ?? []).find((r) => r.repository === 'https://github.com/mutuuslab/feature-topology-platform') : undefined;
  const tools: { system: ExternalSystem; ref?: Ref }[] = [{ system: 'codebeamer', ref: requirement }, { system: 'jira', ref: jira }];
  // Grafana 운영 지표(80-80) — 빌드 설정이 있을 때만. 로그인 대시보드는 이 Feature로 좁히고, 공개 대시보드는 전체를 연다
  const grafana = featureId ? grafanaLinks().feature(featureId, version) : null;
  return (
    <section className="external-launchers" data-compact={compact || undefined} aria-label={T.title}>
      {tools.filter(({ ref }) => DEMO_EXTRAS || (ref && !isDemoReference(ref.system, ref.url))).map(({ system, ref }) => {
        const virtual = DEMO_EXTRAS && (!ref || isDemoReference(ref.system, ref.url));
        return <a key={system} className="external-launcher" data-tool={system} href={ref ? externalReferenceUrl(ref, DEMO_EXTRAS, role) : externalUrl(system, undefined, role)} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow} aria-label={`${T[system].name} ${T.newWindow}`}>
          <span className="external-launcher__top"><strong>{T[system].name}</strong><span className="external-launcher__badge">{virtual ? T.demo : T.connected}</span></span>
          <span className="external-launcher__task">{T[system].task}</span>
          {!compact && <span className="external-launcher__detail">{T[system].detail}</span>}
          <span className="external-launcher__action">{ref?.key ?? T.newWindow}<Icon name="link" size={16} /></span>
        </a>;
      })}
      {grafana && (
        <a className="external-launcher" data-tool="grafana" href={grafana.url} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow} aria-label={`${T.grafana.name} ${T.newWindow}`}>
          <span className="external-launcher__top"><strong>{T.grafana.name}</strong><span className="external-launcher__badge">{T.grafana.badge}</span></span>
          <span className="external-launcher__task">{T.grafana.task}</span>
          {!compact && <span className="external-launcher__detail">{T.grafana.detail}</span>}
          <span className="external-launcher__action">{grafana.scoped ? T.grafana.scoped : T.grafana.overview}<Icon name="link" size={16} /></span>
        </a>
      )}
      <div className="external-launcher" data-tool="github">
        <a className="external-launcher__github" href={GITHUB_PR_URL} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow} aria-label={`GitHub PR #9 ${T.newWindow}`}>
          <span className="external-launcher__top"><strong>GitHub</strong><span className="external-launcher__badge">{T.real}</span></span>
          <span className="external-launcher__task">{T.github.task}</span>
          {!compact && <span className="external-launcher__detail">{T.github.detail}</span>}
          <span className="external-launcher__action">PR #9<Icon name="link" size={16} /></span>
        </a>
        {source && <span className="external-launcher__sources"><a href={source.url} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow}>{T.source}</a><a href={`${source.repository}/commit/${source.commit}`} target="_blank" rel="noopener noreferrer" onClick={openExternalWindow} title={source.commit}>{T.commit} · {source.commit.slice(0, 7)}</a></span>}
      </div>
    </section>
  );
}
