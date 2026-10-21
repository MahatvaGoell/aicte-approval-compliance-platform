import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useSession } from '../session';
import { Empty, ErrorState, formatDate, humanise, Loading, MutationError, Provenance, Status } from '../ui';

// Policy change control: version list, structured view, JSON editor with live validation, diff and publish.

const VERSION_TONE: Record<string, string> = { DRAFT: 'PENDING', PUBLISHED: 'SATISFIED', RETIRED: 'NOT_APPLICABLE' };

export function PolicyListPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['policy-versions'], queryFn: () => api.get<any[]>('/policy/versions') });
  const sources = useQuery({ queryKey: ['policy-sources'], queryFn: () => api.get<any[]>('/policy/sources') });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const latest = versions.data?.[0];

  async function newDraft() {
    if (!latest) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: string }>('/policy/versions', { basedOnId: latest.id, label: `v${latest.version_no + 1} — draft based on v${latest.version_no}` });
      await qc.invalidateQueries({ queryKey: ['policy-versions'] });
      navigate(`/policy/${r.id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="section-head">
        <h1>Policy versions</h1>
        {can('POLICY_DRAFT') && latest && <button className="primary" disabled={busy} onClick={newDraft}>{busy ? 'Creating…' : `New draft from v${latest.version_no}`}</button>}
      </div>
      <p className="muted">Routes, checklists and timings are versioned data. A case keeps the version it was submitted under. Drafting and publishing are separate roles.</p>
      <MutationError error={error} />
      {versions.isLoading ? <div className="card"><Loading /></div> : versions.error ? <ErrorState error={versions.error} onRetry={() => versions.refetch()} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Effective from</th><th>Cases</th><th>Created</th><th>Published</th><th>Change note</th></tr></thead>
            <tbody>
              {versions.data!.map((v) => (
                <tr key={v.id}>
                  <td><Link to={`/policy/${v.id}`}>v{v.version_no}</Link><div className="small muted">{v.label}</div></td>
                  <td><Status value={VERSION_TONE[v.status]} label={humanise(v.status)} /></td>
                  <td>{formatDate(v.effective_from, false)}</td>
                  <td className="num">{v.case_count}</td>
                  <td className="small">{v.created_by_name ?? '—'}<div className="muted">{formatDate(v.created_at)}</div></td>
                  <td className="small">{v.published_by_name ?? '—'}<div className="muted">{formatDate(v.published_at)}</div></td>
                  <td className="small">{v.change_note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="card stack" aria-labelledby="src-title">
        <h2 id="src-title">Source register</h2>
        <p className="small muted">Where rules come from. Only reviewed APH clauses may be presented as handbook requirements.</p>
        {sources.isLoading ? <Loading /> : sources.error ? <ErrorState error={sources.error} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Source</th><th>Provenance</th><th>Issuer</th><th>Review</th><th>Notes</th></tr></thead>
              <tbody>
                {sources.data!.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.title}</strong><div className="small muted mono">{s.id}</div>{s.url && <a className="small" href={s.url} target="_blank" rel="noreferrer">Source document</a>}</td>
                    <td><Provenance value={s.provenance} /></td>
                    <td>{s.issuer}</td>
                    <td><Status value={s.review_status === 'REVIEWED' ? 'SATISFIED' : 'PENDING'} label={humanise(s.review_status)} /></td>
                    <td className="small">{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type Tab = 'overview' | 'edit' | 'compare' | 'publish';

export function PolicyVersionPage() {
  const { id = '' } = useParams();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['policy-version', id], queryFn: () => api.get<any>(`/policy/versions/${id}`) });
  const [tab, setTab] = useState<Tab>('overview');
  if (q.isLoading) return <div className="card"><Loading rows={6} /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;
  const draft = v.status === 'DRAFT';
  const errors = v.issues.filter((i: any) => i.level === 'error');
  const tabs: Array<[Tab, string]> = [['overview', 'Overview'], ...(draft && can('POLICY_DRAFT') ? [['edit', 'Edit'] as [Tab, string]] : []), ['compare', 'Compare'], ...(draft && can('POLICY_PUBLISH') ? [['publish', 'Publish'] as [Tab, string]] : [])];

  return (
    <>
      <header className="stack" style={{ gap: 6 }}>
        <div className="row">
          <h1>Policy v{v.versionNo}</h1>
          <Status value={VERSION_TONE[v.status]} label={humanise(v.status)} />
          {errors.length > 0 && <span className="chip bad">{errors.length} error(s)</span>}
        </div>
        <p className="muted">{v.label} · created {formatDate(v.createdAt)}{v.createdBy ? ` by ${v.createdBy}` : ''}{v.publishedAt && <> · published {formatDate(v.publishedAt)} by {v.publishedBy}, effective {formatDate(v.effectiveFrom, false)}</>}</p>
        {v.changeNote && <p className="small"><strong>Change note:</strong> {v.changeNote}</p>}
      </header>
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        <Link className="btn" to="/policy" style={{ marginLeft: 'auto' }}>All versions</Link>
      </div>
      <div key={tab} className="stack tab-body">
        {tab === 'overview' && <Overview doc={v.document} issues={v.issues} />}
        {tab === 'edit' && <Editor v={v} />}
        {tab === 'compare' && <Compare v={v} />}
        {tab === 'publish' && <Publish v={v} />}
      </div>
    </>
  );
}

function Issues({ issues }: { issues: any[] }) {
  if (!issues.length) return <div className="alert ok">No validation problems.</div>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {issues.map((i, n) => (
        <div key={n} className={`alert ${i.level === 'error' ? 'bad' : 'warn'}`}>
          <strong>{i.level === 'error' ? 'Error' : 'Warning'}</strong> <span className="mono">{i.path || '(document)'}</span> — {i.message}
        </div>
      ))}
    </div>
  );
}

function Overview({ doc, issues }: { doc: any; issues: any[] }) {
  if (!doc?.routes) return <Issues issues={issues} />;
  return (
    <>
      {issues.length > 0 && <Issues issues={issues} />}
      <section className="card stack">
        <h2>Categories and classification</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Rule</th><th>Conditions</th><th>Route</th><th>Priority</th><th>Provenance</th></tr></thead>
            <tbody>
              {(doc.categories ?? []).flatMap((c: any) => {
                const rules = (doc.classification ?? []).filter((r: any) => r.categoryCode === c.code);
                if (!rules.length) return [<tr key={c.code}><td><strong>{c.name}</strong><div className="small muted mono">{c.code}</div></td><td colSpan={4} className="muted">No rule — classified manually</td><td><Provenance value={c.provenance} /></td></tr>];
                return rules.map((r: any, i: number) => (
                  <tr key={r.id}>
                    <td>{i === 0 && <><strong>{c.name}</strong><div className="small muted mono">{c.code}</div></>}</td>
                    <td className="mono small">{r.id}</td>
                    <td className="small">{r.when?.length ? r.when.map((p: any) => `${p.field} ${p.op} ${p.value ?? ''}`).join(' and ') : 'Always'}</td>
                    <td>{doc.routes[r.routeKey]?.name ?? r.routeKey}</td>
                    <td className="num">{r.priority ?? 0}</td>
                    <td><Provenance value={r.provenance} /></td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card stack">
        <h2>Routes</h2>
        <div className="stack">
          {Object.entries<any>(doc.routes).map(([key, r]) => (
            <div key={key} className="row" style={{ justifyContent: 'space-between' }}>
              <div><strong>{r.name}</strong> <span className="small muted mono">{key}</span>
                <div className="small">{r.stages.map((s: string) => doc.stages?.[s]?.name ?? s).join(' → ')}</div></div>
              <Provenance value={r.provenance} />
            </div>
          ))}
          {doc.appeal && <p className="small"><strong>Appeals</strong> against {doc.appeal.appealableOutcomes?.join(', ').toLowerCase()} decisions follow <span className="mono">{doc.appeal.routeKey}</span> within {doc.appeal.windowDays} days <Provenance value={doc.appeal.provenance} /></p>}
        </div>
      </section>
      <section className="card stack">
        <h2>Stages and checklists</h2>
        {Object.entries<any>(doc.stages ?? {}).map(([key, s]) => (
          <div key={key} className="stack" style={{ gap: 6 }}>
            <div className="row"><strong>{s.name}</strong><span className="chip neutral">{humanise(s.kind)}</span><span className="small muted">{humanise(s.ownerRole)}{s.committeeKind ? ` · ${s.committeeKind}` : ''}</span>{s.allowReturn && <span className="chip info">Can return</span>}<Provenance value={s.provenance} /></div>
            <div className="small muted">Completes when: {s.completion?.length ? s.completion.map(humanise).join(', ') : 'decision recorded'}</div>
            {s.checklist?.length > 0 && (
              <ul className="small">{s.checklist.map((c: any) => <li key={c.code}><span className="mono">{c.code}</span> — {c.requirement} <Provenance value={c.provenance} /></li>)}</ul>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function Editor({ v }: { v: any }) {
  const qc = useQueryClient();
  const [text, setText] = useState(() => JSON.stringify(v.document, null, 2));
  const [label, setLabel] = useState(v.label);
  const [issues, setIssues] = useState<any[]>(v.issues);
  const [parseError, setParseError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Validate while typing (debounced).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const doc = JSON.parse(text);
        setParseError(null);
        const r = await api.post<{ issues: any[] }>('/policy/validate', { document: doc });
        setIssues(r.issues);
      } catch (e) {
        if (e instanceof SyntaxError) setParseError(e.message);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [text]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    try {
      const r = await api.put<any>(`/policy/versions/${v.id}`, { document: JSON.parse(text), label, expectedVersion: v.rowVersion });
      setSaved(r.changes.length ? `Saved. ${r.changes.length} change(s) in this save.` : 'Saved. No changes.');
      await qc.invalidateQueries({ queryKey: ['policy-version', v.id] });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Edit draft</h2>
      <p className="small muted">The document is validated as you type. Every rule needs a provenance; use DEMO_ASSUMPTION unless a reviewed source supports it.</p>
      <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} required minLength={3} /></label>
      <label>Policy document (JSON)
        <textarea className="mono code-editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {parseError ? <div className="alert bad"><strong>Not valid JSON:</strong> {parseError}</div> : <Issues issues={issues} />}
      <MutationError error={error} />
      {saved && <div className="alert ok">{saved}</div>}
      <div className="row"><button className="primary" type="submit" disabled={busy || !!parseError}>{busy ? 'Saving…' : 'Save draft'}</button></div>
    </form>
  );
}

function Compare({ v }: { v: any }) {
  const versions = useQuery({ queryKey: ['policy-versions'], queryFn: () => api.get<any[]>('/policy/versions') });
  const others = useMemo(() => (versions.data ?? []).filter((x) => x.id !== v.id), [versions.data, v.id]);
  const [from, setFrom] = useState('');
  const base = from || v.basedOnId || others[0]?.id || '';
  const diff = useQuery({
    queryKey: ['policy-diff', base, v.id], enabled: !!base,
    queryFn: () => api.get<any>(`/policy/diff${qs({ from: base, to: v.id })}`),
  });
  return (
    <section className="card stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>Changes</h2>
        <label className="row" style={{ fontWeight: 400 }}>Compared with
          <select value={base} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }}>
            {others.map((o) => <option key={o.id} value={o.id}>v{o.version_no} ({humanise(o.status)})</option>)}
          </select>
        </label>
      </div>
      {!base ? <Empty>No other version to compare with.</Empty> : diff.isLoading ? <Loading /> : diff.error ? <ErrorState error={diff.error} /> : diff.data.changes.length === 0 ? <Empty>No differences.</Empty> : (
        <ul className="diff">
          {diff.data.changes.map((c: any, i: number) => (
            <li key={i} className={c.change}>
              <span className="chip neutral">{humanise(c.section)}</span>
              <span className={`diff-tag ${c.change}`}>{c.change}</span>
              <span>{c.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Publish({ v }: { v: any }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errors = v.issues.filter((i: any) => i.level === 'error');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/policy/versions/${v.id}/publish`, { effectiveFrom, changeNote, expectedVersion: v.rowVersion });
      await qc.invalidateQueries({ queryKey: ['policy-versions'] });
      await qc.invalidateQueries({ queryKey: ['policy-version', v.id] });
      navigate(`/policy/${v.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <form className="card stack action-panel human" onSubmit={publish}>
      <h2>Publish v{v.versionNo}</h2>
      <p className="small muted">Publishing makes this version apply to applications submitted on or after the effective date. Cases already submitted keep their version.</p>
      <Issues issues={v.issues} />
      <div className="form-grid">
        <label>Effective from<input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /></label>
      </div>
      <label>Change note<textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} required minLength={10} placeholder="What changed and on whose instruction" /></label>
      <MutationError error={error} />
      <div><button className="primary" type="submit" disabled={busy || errors.length > 0}>{busy ? 'Publishing…' : 'Publish version'}</button></div>
    </form>
  );
}
