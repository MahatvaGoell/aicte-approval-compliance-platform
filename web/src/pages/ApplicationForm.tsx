import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {ResourceClaimsForm,EMPTY_RESOURCES,type ResourceInputs} from './ResourceClaimsForm';
import { api, ApiError } from '../api';
import { Icon } from '../motion';
import { ErrorState, Loading, MutationError, Provenance } from '../ui';
import { useReference } from './Applications';

interface Programme { name: string; level: 'DIPLOMA' | 'UG' | 'PG'; intake: number }
interface FormState {
  cycleCode: string;
  categoryCode: string;
  intakeIncreasePercent: string;
  proposedSiteAddress: string;
  campusAddress: string;
  landAreaAcres: string;
  programmes: Programme[];
  declarationAccepted: boolean;
  remarks: string;
  resources:ResourceInputs;
}

const EMPTY: FormState = {
  cycleCode: '2027-28', categoryCode: '', intakeIncreasePercent: '', proposedSiteAddress: '', campusAddress: '', landAreaAcres: '',
  programmes: [{ name: '', level: 'UG', intake: 60 }], declarationAccepted: false, remarks: '',resources:EMPTY_RESOURCES,
};

function toPayload(f: FormState) {
  const details: Record<string, unknown> = {};
  if (f.categoryCode === 'INCREASE_IN_INTAKE' && f.intakeIncreasePercent !== '') details.intakeIncreasePercent = Number(f.intakeIncreasePercent);
  if (f.categoryCode === 'CHANGE_OF_SITE' && f.proposedSiteAddress) details.proposedSiteAddress = f.proposedSiteAddress;
  const draftData: Record<string, unknown> = { declarationAccepted:f.declarationAccepted,...f.resources };
  if (f.campusAddress) draftData.campusAddress = f.campusAddress;
  if (f.landAreaAcres !== '') draftData.landAreaAcres = Number(f.landAreaAcres);
  const programmes = f.programmes.filter((p) => p.name.trim());
  if (programmes.length) draftData.programmes = programmes.map((p) => ({ ...p, intake: Number(p.intake) }));
  if (f.remarks) draftData.remarks = f.remarks;
  return { details, draftData };
}

export function ApplicationFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ref = useReference();
  const existing = useQuery({ queryKey: ['case', id], queryFn: () => api.get<any>(`/applications/${id}`), enabled: !!id });
  const [form, setForm] = useState<FormState>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  useEffect(() => {
    if (!existing.data) return;
    const v = existing.data;
    setVersion(v.application.rowVersion);
    setForm({
      cycleCode: v.application.cycleCode,
      categoryCode: v.proposal.categoryCode,
      intakeIncreasePercent: v.proposal.details.intakeIncreasePercent?.toString() ?? '',
      proposedSiteAddress: v.proposal.details.proposedSiteAddress ?? '',
      campusAddress: v.form.campusAddress ?? '',
      landAreaAcres: v.form.landAreaAcres?.toString() ?? '',
      programmes: v.form.programmes?.length ? v.form.programmes : EMPTY.programmes,
      declarationAccepted: !!v.form.declarationAccepted,
      remarks: v.form.remarks ?? '',
      resources:{faculty:v.form.faculty??[],labs:v.form.labs??[],buildings:v.form.buildings??[]},
    });
  }, [existing.data]);

  if (id && existing.isLoading) return <div className="card"><Loading /></div>;
  if (id && existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (id && existing.data && !existing.data.canEditDraft) {
    return <div className="card empty">This application has been submitted and is frozen. Changes require a linked amendment.</div>;
  }

  const fieldError = (field: string) =>
    error instanceof ApiError && Array.isArray(error.details) ? error.details.find((d: any) => d.field === field)?.message : undefined;
  const upd = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const category = ref.data?.activePolicy.categories.find((c) => c.code === form.categoryCode);
  const parts = [
    { label: 'Approval sought', target: 'approval', entered: !!form.categoryCode },
    { label: 'Campus', target: 'campus', entered: !!form.campusAddress.trim() && !!form.landAreaAcres },
    { label: 'Programmes', target: 'programmes', entered: form.programmes.some((p) => !!p.name.trim()) },
    { label: 'Declaration', target: 'declaration', entered: form.declarationAccepted },
  ];

  async function save(): Promise<{ id: string; rowVersion: number }> {
    const { details, draftData } = toPayload(form);
    const draftId = id ?? createdId;
    if (!draftId) {
      const created = await api.post<{ id: string; rowVersion: number }>('/applications', { cycleCode: form.cycleCode, categoryCode: form.categoryCode, details, draftData });
      // Remember the draft so a failed submit followed by a retry updates it instead of creating a duplicate.
      setCreatedId(created.id);
      setVersion(created.rowVersion);
      return created;
    }
    const r = await api.put<{ rowVersion: number }>(`/applications/${draftId}/draft`, { expectedVersion: version, categoryCode: form.categoryCode, details, draftData });
    setVersion(r.rowVersion);
    return { id: draftId, rowVersion: r.rowVersion };
  }

  async function onSave() {
    setBusy('save'); setError(null);
    try {
      const r = await save();
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['case', r.id] });
      navigate(`/applications/${r.id}`);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  async function onSubmit() {
    setBusy('submit'); setError(null);
    try {
      const r = await save();
      await api.post(`/applications/${r.id}/submit`, { expectedVersion: r.rowVersion });
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['case', r.id] });
      navigate(`/applications/${r.id}`);
    } catch (e) {
      setError(e);
    } finally { setBusy(null); }
  }

  return (
    <form className="stack application-editor" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <header className="page-head">
        <div><h1>{id ? `Edit draft ${existing.data?.application.appNo ?? ''}` : 'New application'}</h1><p>Fill the four parts below. Save a draft at any time; submitting freezes it.</p></div>
      </header>
      <div className="editor-layout">
      <div className="stack editor-fields">
      <div className="form-sheet-head" aria-hidden="true"><span>Application for approval · cycle {form.cycleCode}</span><span>{id ? 'Draft on record' : 'New draft'} · demonstration form</span></div>
      <section className="card stack" id="form-approval">
        <h2><span className="section-number">1</span>Approval sought</h2>
        <div className="form-grid">
          <label>Academic cycle
            <select id="cycle" value={form.cycleCode} disabled={!!id} onChange={(e) => upd({ cycleCode: e.target.value })}>
              {ref.data?.cycles.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <label>Category
            <select id="category" value={form.categoryCode} onChange={(e) => upd({ categoryCode: e.target.value })} required>
              <option value="">Choose a category</option>
              {ref.data?.activePolicy.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
        </div>
        {category && <p className="small muted">{category.description} <Provenance value={category.provenance} /></p>}
        {form.categoryCode === 'INCREASE_IN_INTAKE' && (
          <label>Intake increase (%)
            <input id="intake-pct" type="number" min={0} max={1000} value={form.intakeIncreasePercent} onChange={(e) => upd({ intakeIncreasePercent: e.target.value })} />
            {fieldError('details.intakeIncreasePercent') && <span className="field-error">{fieldError('details.intakeIncreasePercent')}</span>}
          </label>
        )}
        {form.categoryCode === 'CHANGE_OF_SITE' && (
          <label>Proposed new site address
            <input id="site" value={form.proposedSiteAddress} onChange={(e) => upd({ proposedSiteAddress: e.target.value })} />
            {fieldError('details.proposedSiteAddress') && <span className="field-error">{fieldError('details.proposedSiteAddress')}</span>}
          </label>
        )}
      </section>

      <section className="card stack" id="form-campus">
        <h2><span className="section-number">2</span>Campus</h2>
        <div className="form-grid">
          <label>Campus address
            <input id="campus" value={form.campusAddress} onChange={(e) => upd({ campusAddress: e.target.value })} />
            {fieldError('campusAddress') && <span className="field-error">{fieldError('campusAddress')}</span>}
          </label>
          <label>Land area (acres)
            <input id="land" type="number" step="0.01" min={0} value={form.landAreaAcres} onChange={(e) => upd({ landAreaAcres: e.target.value })} />
            {fieldError('landAreaAcres') && <span className="field-error">{fieldError('landAreaAcres')}</span>}
          </label>
        </div>
      </section>

      <section className="card stack" id="form-programmes">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2><span className="section-number">3</span>Programmes</h2>
          <button type="button" onClick={() => upd({ programmes: [...form.programmes, { name: '', level: 'UG', intake: 60 }] })}>Add programme</button>
        </div>
        {form.programmes.map((p, i) => (
          <div className="form-grid programme-row" key={i}>
            <label>Programme name<input id={`prog-${i}-name`} value={p.name} onChange={(e) => upd({ programmes: form.programmes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></label>
            <label>Level
              <select id={`prog-${i}-level`} value={p.level} onChange={(e) => upd({ programmes: form.programmes.map((x, j) => (j === i ? { ...x, level: e.target.value as Programme['level'] } : x)) })}>
                <option value="DIPLOMA">Diploma</option><option value="UG">Undergraduate</option><option value="PG">Postgraduate</option>
              </select>
            </label>
            <label>Intake<input id={`prog-${i}-intake`} type="number" min={1} max={600} value={p.intake} onChange={(e) => upd({ programmes: form.programmes.map((x, j) => (j === i ? { ...x, intake: Number(e.target.value) } : x)) })} /></label>
            <div className="row" style={{ alignSelf: 'end' }}>
              {form.programmes.length > 1 && <button type="button" className="link" onClick={() => upd({ programmes: form.programmes.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          </div>
        ))}
        {fieldError('programmes') && <span className="field-error">{fieldError('programmes')}</span>}
      </section>

      <ResourceClaimsForm value={form.resources} onChange={resources=>upd({resources})}/>
      <section className="card stack" id="form-declaration">
        <h2><span className="section-number">4</span>Declaration</h2>
        <label>Remarks (optional)<textarea id="remarks" value={form.remarks} onChange={(e) => upd({ remarks: e.target.value })} /></label>
        <label className="row" style={{ fontWeight: 400 }}>
          <input id="declaration" type="checkbox" checked={form.declarationAccepted} onChange={(e) => upd({ declarationAccepted: e.target.checked })} />
          I declare that the information provided is correct (demonstration declaration).
        </label>
        {fieldError('declarationAccepted') && <span className="field-error">{fieldError('declarationAccepted')}</span>}
      </section>
      </div>
      <aside className="editor-guide">
        <div className="stack">
          <h2>Your draft, at a glance</h2>
          <p className="small muted">These fields have been entered. Submission checks still apply when you submit.</p>
          <div className="editor-progress" role="progressbar" aria-label="Parts entered" aria-valuemin={0} aria-valuemax={4} aria-valuenow={parts.filter((p) => p.entered).length}><i style={{ transform: `scaleX(${parts.filter((p) => p.entered).length / 4})` }} /></div>
          <ul className="draft-checklist">
            {parts.map((item) => <li key={item.target}><a href={`#form-${item.target}`}><span className={`draft-check ${item.entered ? 'entered' : ''}`}>{item.entered ? <Icon name="check" /> : null}</span><span>{item.label}<small>{item.entered ? 'Entered' : 'Not entered'}</small></span></a></li>)}
          </ul>
          <p className="small muted">Submission freezes the application. You can save your draft before that.</p>
        </div>
      </aside>
      </div>
      <MutationError error={error} />
      <div className="row editor-footer">
        <button type="submit" disabled={!!busy || !form.categoryCode}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="primary" disabled={!!busy || !form.categoryCode} onClick={onSubmit}>{busy === 'submit' ? 'Submitting…' : 'Save and submit'}</button>
        <span className="small muted">Once submitted, the application is frozen and its route is chosen by the policy in effect.</span>
      </div>
    </form>
  );
}
