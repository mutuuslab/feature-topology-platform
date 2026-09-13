// 기준 상세 영역 사실(facts) 패널 — 운영 화면이 사양서를 인용하지 않고 사양서의 값을 그대로 보여준다.
//
// 정본: public/spec/data/screen-UIxx.json (FP-DETAILED-1.1 / FP-UI-MENU-1.3 산출물에서 생성).
// 큰 JSON 은 번들에 넣지 않고 런타임에 읽는다(data/specIa.ts). 화면마다 별도 TS 를 생성하지 않는다.
//
// 이 패널은 "무엇을 구현해야 하는가"가 아니라 "이 영역이 어떤 입력·조회·상태·권한·인수 조건을
// 갖는가"를 노출한다. 운영 화면은 같은 값을 실제 데이터로 계산해 보여주고, 이 패널은 그 계약을 붙인다.
import { useMemo } from 'react';
import { useAsync } from '../hooks/useAsync';
import { loadScreenDetail } from '../data/specIa';
import type { SpecAction, SpecArea, SpecScreenDetail } from '../data/specTypes';

export interface ScreenAreas {
  loading: boolean;
  error?: Error;
  screen?: SpecScreenDetail;
  areas: SpecArea[];
  area: (id?: string) => SpecArea | undefined;
}

/** 화면 상세(영역·작업·인수)를 읽는 단일 경로. 같은 screenId 는 로더가 캐시하므로 반복 호출이 안전하다. */
export function useScreenAreas(uiId: string): ScreenAreas {
  const detail = useAsync(() => loadScreenDetail(uiId), [uiId]);
  return useMemo(() => {
    const areas = detail.data?.areas ?? [];
    return {
      loading: detail.loading,
      error: detail.error,
      screen: detail.data,
      areas,
      area: (id?: string) => (id ? areas.find(a => a.id === id) : undefined),
    };
  }, [detail.data, detail.loading, detail.error]);
}

const STATUS_KO: Record<string, string> = {
  DESIGNED: '설계 완료', IMPLEMENTED: '구현', PLANNED: '계획', PARTIAL: '일부', NOT_STARTED: '미착수',
  VERIFIED: '검증 완료', RUNTIME: '런타임', MOCKED: '모의', LIVE: '운영', PENDING: '대기',
};

function Pill({ children, color }: { children: React.ReactNode; color?: string }) {
  return <span className="pill" style={color ? { color, borderColor: color } : undefined}>{children}</span>;
}

function KV({ rows, width }: { rows: [string, React.ReactNode][]; width?: number }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  if (!shown.length) return <p className="small muted">기준 값 없음</p>;
  return (
    <div className="kv" style={width ? { gridTemplateColumns: `${width}px 1fr` } : undefined}>
      {shown.map(([k, v], i) => (
        <div key={`${k}-${i}`} style={{ display: 'contents' }}>
          <div className="small muted">{k}</div>
          <div className="small">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, count, children, open }: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="card" style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        {title}{count != null ? <span className="small muted"> · {count}</span> : null}
      </summary>
      <div className="mt">{children}</div>
    </details>
  );
}

function StatusPills({ area }: { area: SpecArea }) {
  const items: [string, string][] = [
    ['설계', area.designStatus], ['구현', area.implementationStatus],
    ['연계', area.integrationStatus], ['검증', area.verificationStatus], ['프로토타입', area.prototypeStatus],
  ];
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {items.filter(([, v]) => !!v).map(([k, v]) => (
        <Pill key={k} color={v === 'VERIFIED' || v === 'RUNTIME' || v === 'IMPLEMENTED' ? '#1F9D55' : undefined}>
          {k} {STATUS_KO[v] || v}
        </Pill>
      ))}
      <Pill color={area.editable ? '#0B5FFF' : '#8895A7'}>{area.editable ? '편집 가능' : '조회 전용'}</Pill>
    </div>
  );
}

function ActionTable({ actions }: { actions: SpecAction[] }) {
  if (!actions.length) return <p className="small muted">이 영역에 등록된 작업이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>작업 ID</th><th>동작</th><th>유형</th><th>이동·대상</th><th>선행 조건</th><th>결과</th><th>실패 처리</th><th>역할</th><th>API</th><th>인수</th></tr></thead>
        <tbody>
          {actions.map(a => (
            <tr key={a.id}>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}>{a.id}</td>
              <td>{a.label}</td>
              <td className="small">{a.type}{a.targetMenu ? ` · ${a.targetMenu}` : ''}</td>
              <td className="small">{a.opens || '—'}</td>
              <td className="small">{a.preconditions?.length ? a.preconditions.join(' · ') : '—'}</td>
              <td className="small">{a.result || '—'}</td>
              <td className="small">{a.failure || (a.errors?.length ? a.errors.join(' · ') : '—')}</td>
              <td className="small">{a.roles?.length ? a.roles.join(', ') : a.permission || '—'}</td>
              <td className="mono small" style={{ wordBreak: 'break-all' }}>{a.api?.method} {a.api?.path}{a.api?.schema ? <div className="muted">{a.api.schema}{a.api.status ? ` · ${a.api.status}` : ''}</div> : null}</td>
              <td className="small">{a.acceptanceId || '—'}{a.acceptanceSteps?.length ? <div className="muted">{a.acceptanceSteps.join(' · ')}</div> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 영역 하나의 기준 사실을 그대로 노출한다. 각 화면은 자기 계산 결과 위에 이 패널을 붙여
 * "구현 결과"와 "그 구현이 따라야 하는 계약"을 같은 화면에서 대조할 수 있게 한다.
 */
export function SpecAreaFacts({ uiId, areaId, open = false }: { uiId: string; areaId?: string; open?: boolean }) {
  const { loading, error, screen, areas, area } = useScreenAreas(uiId);
  const a = area(areaId);

  if (loading) return <div className="card muted small">기준 상세 영역을 읽는 중… ({uiId})</div>;
  if (error) {
    return (
      <div className="card small muted">
        기준 상세 데이터를 읽지 못했습니다 — {String(error.message || error)}. 공개 경로 /spec/data/screen-{uiId}.json 이 필요합니다.
      </div>
    );
  }
  if (!a) {
    return (
      <div className="card small muted">
        기준에 {areaId || '(영역 미지정)'} 영역이 없습니다. {uiId} 영역: {areas.map(x => x.id).join(' · ')}
      </div>
    );
  }

  const rp = a.rolePolicy;
  return (
    <div className="mt">
      <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
        <b>{a.id} · {a.name}</b>
        <Pill>{a.type}</Pill>
        {a.anchor ? <span className="mono small muted">{a.anchor}</span> : null}
        <span className="small muted">{screen?.name} ({uiId})</span>
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        정본 객체 <span className="mono">{a.canonicalObject || '—'}</span> · 책임 {a.coreOwner || a.owner || '—'}
        {a.coreName ? ` (${a.coreName})` : ''}{a.gatewayCore ? ` · 경유 core ${a.gatewayCore}` : ''} · 배치 {a.placement || '—'}
      </p>
      <StatusPills area={a} />

      <Section title="배치와 구성" open={open}>
        <KV rows={[
          ['영역 배치', a.placement],
          ['layout', <span className="mono small" style={{ wordBreak: 'break-all' }}>{a.layout || '—'}</span>],
          ['layout 이름', a.layoutName],
          ['route', <span className="mono small">{a.route || '—'}</span>],
          ['목록 화면', a.screenId ? <span className="mono small">{a.screenId}</span> : null],
          ['상세 화면', a.detailScreenId ? <span className="mono small">{a.detailScreenId}</span> : null],
          ['편집 화면', a.editScreenId ? <span className="mono small">{a.editScreenId}</span> : null],
          ['확인 화면', a.confirmScreenId ? <span className="mono small">{a.confirmScreenId}</span> : null],
          ['상세 탭', a.detailTabs?.length ? a.detailTabs.join(' · ') : null],
          ['영역 설명', a.domainDetail],
          ['구현', a.implementation],
          ['이전 기준', a.previousCoverage?.coverage || a.previousCoverage?.implementation],
          ['커버리지', a.coverage],
          ['보유 Task', a.tasks?.length ? `${a.tasks.length}건 · ${a.tasks.join(', ')}` : null],
          ['규칙', a.rules?.length ? a.rules.join(' · ') : null],
        ]} />
      </Section>

      <Section title="입력 — 정확 참조와 입력 시점" count={a.inputFields?.length}>
        {a.inputFields?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>속성 ID</th><th>원천 유형</th><th>필요 시점</th><th>설명</th></tr></thead>
              <tbody>
                {a.inputFields.map(f => (
                  <tr key={f.id}>
                    <td className="mono">{f.id}</td><td className="small">{f.sourceType}</td>
                    <td className="small">{f.requiredStage}</td><td className="small">{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">이 영역은 값을 직접 받지 않습니다(schema {a.inputSchemaId || '—'}).</p>}
      </Section>

      <Section title="조회 — API 와 선행 조회" count={a.readDependencies?.length}>
        <KV rows={[
          ['조회 schema', <span className="mono small">{a.inputSchemaId || '—'}</span>],
          ['응답 schema', <span className="mono small">{a.responseSchemaId || '—'}</span>],
          ['조회 API', <span className="mono small" style={{ wordBreak: 'break-all' }}>{a.readApi?.method} {a.readApi?.path}{a.readApi?.status ? ` → ${a.readApi.status}` : ''}</span>],
          ['projection', a.readApi?.projection],
          ['query', a.readApi?.query ? <span className="mono small" style={{ wordBreak: 'break-all' }}>{JSON.stringify(a.readApi.query)}</span> : null],
          ['profile', a.readApi?.profile],
          ['응답 열', a.responseColumns?.length ? a.responseColumns.join(' · ') : null],
          ['응답 metadata', a.responseMetadata?.length ? a.responseMetadata.join(' · ') : null],
          ['선택 의미', a.responseSelection],
          ['빈 결과', a.responseEmpty],
        ]} />
        {a.readDependencies?.length ? (
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>선행 조회</th><th>목적</th></tr></thead>
              <tbody>
                {a.readDependencies.map(d => (
                  <tr key={d.path}><td className="mono small" style={{ wordBreak: 'break-all' }}>{d.method} {d.path}</td><td className="small">{d.purpose}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="상태·권한·규칙" count={a.states?.length}>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 230 }}>
            <div className="small muted">상태별 동작</div>
            {a.states?.length ? a.states.map(s => (
              <div key={s.state} className="small" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
                <b className="mono">{s.state}</b> {s.behavior}
                <div className="muted">입력 보존: {s.inputPreserved ? '예' : '아니오'}</div>
              </div>
            )) : <div className="small muted">—</div>}
          </div>
          <div style={{ minWidth: 230 }}>
            <div className="small muted">역할 정책</div>
            <KV rows={[['조회', rp?.read], ['편집', rp?.edit], ['승인', rp?.approve], ['원천 write', rp?.sourceWrite]]} />
          </div>
        </div>
        <KV rows={[
          ['상태 규칙', a.stateRule],
          ['기본 규칙', a.defaultRules],
        ]} />
      </Section>

      <Section title="업무 명령" count={a.businessCommands?.length}>
        {a.businessCommands?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>명령</th><th>역할</th><th>전이</th><th>guard</th><th>API</th><th>결과</th><th>인수</th></tr></thead>
              <tbody>
                {a.businessCommands.map(c => (
                  <tr key={c.id}>
                    <td className="mono small">{c.id}<div className="muted">{c.label}</div></td>
                    <td className="small">{c.role}</td>
                    <td className="mono small">{c.fromStates.join(', ')} → {c.toState}</td>
                    <td className="small">{c.guard || '—'}</td>
                    <td className="mono small" style={{ wordBreak: 'break-all' }}>{c.api}</td>
                    <td className="small">{c.result || '—'}</td>
                    <td className="small">{c.acceptanceId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">이 영역은 업무 명령을 직접 실행하지 않습니다.</p>}
      </Section>

      <Section title="편집 항목" count={a.editFields?.length}>
        {a.editFields?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>항목</th><th>표시명</th><th>자료형</th><th>필수</th><th>출처</th></tr></thead>
              <tbody>
                {a.editFields.map(f => (
                  <tr key={f.key}>
                    <td className="mono small">{f.key}</td><td className="small">{f.label}</td>
                    <td className="mono small">{f.type}</td><td className="small">{f.required ? '필수' : '선택'}</td>
                    <td className="small">{f.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">이 영역은 편집 항목이 없습니다(조회·검증 영역).</p>}
      </Section>

      <Section title="작업" count={a.actions?.length}>
        <ActionTable actions={a.actions ?? []} />
      </Section>

      <Section title="인수와 참조">
        <KV rows={[
          ['인수 ID', a.acceptanceId ? <span className="mono small">{a.acceptanceId}</span> : null],
          ['인수 기준', a.acceptanceCriteria?.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{a.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}</ul> : null],
          ['참조', a.references?.length ? a.references.map(r => <div key={r} className="mono small" style={{ wordBreak: 'break-all' }}>{r}</div>) : null],
          ['화면 인수', screen?.acceptance?.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{screen.acceptance.map((c, i) => <li key={i}>{c}</li>)}</ul> : null],
          ['화면 예외', screen?.exception],
          ['화면 완료 조건', screen?.done],
        ]} />
      </Section>
    </div>
  );
}

/** 목록·표 위에 붙이는 한 줄 계약 요약 — 영역을 고르지 않아도 이 영역이 무엇을 요구하는지 보인다. */
export function SpecAreaContract({ uiId, areaId }: { uiId: string; areaId?: string }) {
  const { area } = useScreenAreas(uiId);
  const a = area(areaId);
  if (!a) return null;
  return (
    <p className="small muted">
      기준 {a.id} · 정본 <span className="mono">{a.canonicalObject || '—'}</span> · 책임 {a.coreOwner || '—'}
      {a.coreName ? ` (${a.coreName})` : ''} · {a.editable ? '편집 가능' : '조회 전용'}
      {a.acceptanceId ? ` · 인수 ${a.acceptanceId}` : ''}
      {a.actions?.length ? ` · 작업 ${a.actions.length}건` : ''}
      {a.inputFields?.length ? ` · 입력 ${a.inputFields.length}건` : ''}
    </p>
  );
}
