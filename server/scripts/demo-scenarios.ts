// Creates prepared demo cases at different points of the workflow through the public API, so a demo can
// start from any stage. Needs the API running in demo mode (npm run dev:api) on a freshly reset database.
//   npm run demo:scenarios
import crypto from 'node:crypto';
import 'dotenv/config';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api/v1`;

class Session {
  cookie = '';
  constructor(public email: string) {}
  async login() {
    const res = await fetch(`${BASE}/auth/demo-login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'aicte-web' }, body: JSON.stringify({ email: this.email }),
    });
    if (!res.ok) throw new Error(`demo login failed for ${this.email}: ${res.status} ${await res.text()}`);
    this.cookie = String(res.headers.get('set-cookie')).split(';')[0];
    return this;
  }
  async call(method: string, url: string, body?: unknown) {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'aicte-web', cookie: this.cookie, 'idempotency-key': 'demo-' + crypto.randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url} as ${this.email}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  get(url: string) { return this.call('GET', url); }
  async upload(id: string, metadata: Record<string, unknown>, bytes: string, filename: string) {
    const v = await this.get(`/applications/${id}`);
    const form = new FormData();
    form.append('metadata', JSON.stringify({expectedVersion:v.application.rowVersion,...metadata}));
    form.append('file', new Blob([bytes],{type:'application/pdf'}),filename);
    const res = await fetch(`${BASE}/applications/${id}/documents/uploads`,{method:'POST',headers:{cookie:this.cookie,'x-requested-with':'aicte-web','idempotency-key':'demo-'+crypto.randomUUID()},body:form});
    const data = await res.json(); if(!res.ok) throw new Error(`Synthetic upload failed: ${res.status} ${JSON.stringify(data)}`); return data;
  }
  async command(id: string, command: string, payload: Record<string, unknown> = {}) {
    const v = await this.get(`/applications/${id}`);
    return this.call('POST', `/applications/${id}/commands`, { command, expectedVersion: v.application.rowVersion, ...payload });
  }
}

const sessions = new Map<string, Session>();
async function as(email: string) {
  const short = email.includes('@') ? email : `${email}@demo.aicte.test`;
  if (!sessions.has(short)) sessions.set(short, await new Session(short).login());
  return sessions.get(short)!;
}

const FORM = {
  campusAddress: '12 Demo Road, Hinjawadi, Pune',
  landAreaAcres: 12.5,
  programmes: [{ name: 'B.Tech Computer Engineering', level: 'UG', intake: 120 }, { name: 'M.Tech Data Science', level: 'PG', intake: 30 }],
  declarationAccepted: true,
};

async function submit(instEmail: string, categoryCode: string, details: Record<string, unknown> = {}) {
  const inst = await as(instEmail);
  const created = await inst.call('POST', '/applications', { cycleCode: '2027-28', categoryCode, details, draftData: FORM });
  await inst.call('POST', `/applications/${created.id}/submit`, { expectedVersion: created.rowVersion });
  return created.id as string;
}

async function ownerOf(id: string) {
  const ro = await as('bureau');
  const v = await ro.get(`/applications/${id}`);
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  const users: Record<string, string> = {
    'Dr. A. Joshi (demo scrutiny member)': 'scrutiny.west1', 'Dr. N. Shah (demo scrutiny member)': 'scrutiny.west2',
    'Dr. M. Gupta (demo scrutiny member)': 'scrutiny.north1', 'Justice (Retd.) I. Khan (demo SAC member)': 'sac1',
    'Competent Authority (demo)': 'authority', 'R. Patil (demo regional officer)': 'ro.west', 'S. Verma (demo regional officer)': 'ro.north',
  };
  return as(users[stage.assignee.name]);
}

async function scrutinise(id: string, recommendation = 'RECOMMEND_APPROVAL') {
  const m = await ownerOf(id);
  const v = await m.get(`/applications/${id}`);
  const stage = v.stages.find((s: any) => s.id === v.currentStageId);
  await m.command(id, 'SAVE_CHECKLIST', { items: stage.checklist.map((i: any) => ({ code: i.code, status: 'SATISFIED' })) });
  await m.command(id, 'RECORD_RECOMMENDATION', {
    recommendation, text: 'All checklist requirements verified against the records on file (demo).',
    proposedConditions: recommendation === 'RECOMMEND_APPROVAL_WITH_CONDITIONS' ? ['Submit a renewed registered lease deed'] : [],
  });
  await m.command(id, 'COMPLETE_STAGE', { note: 'Scrutiny completed' });
}

async function main() {
  const made: string[] = [];
  const label = async (id: string, what: string) => made.push(`${(await (await as('bureau')).get(`/applications/${id}`)).application.appNo}  ${what}`);

  // 1. Fresh submission waiting for scrutiny.
  const a = await submit('inst.west', 'EXTENSION_OF_APPROVAL');
  await label(a, 'Pune · extension · in scrutiny (start here)');

  // 2. Returned to the institution with findings.
  const b = await submit('inst.west', 'INCREASE_IN_INTAKE', { intakeIncreasePercent: 20 });
  {
    const m = await ownerOf(b);
    const v = await m.get(`/applications/${b}`);
    const stage = v.stages.find((s: any) => s.id === v.currentStageId);
    await m.command(b, 'SAVE_CHECKLIST', { items: stage.checklist.map((i: any) => i.code === 'LAND_DOCUMENTS'
      ? { code: i.code, status: 'DEFICIENT', observation: 'Lease deed on record expired in March 2026' } : { code: i.code, status: 'SATISFIED' }) });
    await m.command(b, 'RAISE_FINDING', {
      checklistCode: 'LAND_DOCUMENTS', reasonCode: 'MISSING_DOCUMENT', visibility: 'INSTITUTION', requestsAmendment: true,
      explanation: 'The registered lease deed on record expired in March 2026. Upload a renewed registered lease deed covering the cycle.',
      requestedEvidence: 'Renewed registered lease deed',
    });
    await m.command(b, 'RETURN_TO_INSTITUTION', { reason: 'Land documents are not current', responseDueNote: 'Demo: respond within 15 days' });
  }
  await label(b, 'Pune · intake increase · returned to institution, awaiting response');

  // 3. Waiting for manual classification.
  const c = await submit('inst.west', 'OTHER_REQUEST');
  await label(c, 'Pune · other request · awaiting classification (sign in as ro.west)');

  // 4. At the decision stage.
  const d = await submit('inst.north', 'EXTENSION_OF_APPROVAL');
  await scrutinise(d);
  await label(d, 'Lucknow · extension · awaiting decision (sign in as authority)');

  // 5. Rejected, then appealed to SAC.
  const e = await submit('inst.west', 'EXTENSION_OF_APPROVAL');
  await scrutinise(e, 'RECOMMEND_REJECTION');
  await (await as('authority')).command(e, 'RECORD_DECISION', { outcome: 'REJECTED', reason: 'Faculty strength below the demo norm for the intake applied for.' });
  await (await as('inst.west')).command(e, 'FILE_APPEAL', { grounds: 'Faculty appointments made in June were not considered; appointment letters are on record.' });
  await label(e, 'Pune · extension · rejected, appeal at SAC review (sign in as sac1)');

  // 6. Approved with conditions.
  const f = await submit('inst.north', 'EXTENSION_OF_APPROVAL');
  await scrutinise(f, 'RECOMMEND_APPROVAL_WITH_CONDITIONS');
  await (await as('authority')).command(f, 'RECORD_DECISION', {
    outcome: 'APPROVED_WITH_CONDITIONS', reason: 'Approved subject to a renewed lease deed.',
    conditions: [{ text: 'Submit a renewed registered lease deed for the campus', dueInDays: 60 }],
  });
  const northVerifier = await as('ro.north');
  await northVerifier.command(f,'CREATE_OBLIGATION',{conditionIndex:0,requiredDocumentType:'LEASE_DEED',verifierUserId:(await northVerifier.get('/me')).user.id,reason:'Track the recorded synthetic approval condition for evidence review.'});
  await label(f, 'Lucknow · approved with conditions · open lease obligation (institution submits evidence)');

  // 7. Ready EVC queue, no inspection proposal yet.
  const g = await submit('inst.west', 'CHANGE_OF_SITE', { proposedSiteAddress: '44 Synthetic Campus Road, Pune' });
  await label(g, 'Pune · EVC ready queue · propose a visit (ro.west)');

  // 8. Confirmed visit with real reservations; advance the demo clock after acknowledgements to record it held.
  const h = await submit('inst.west', 'CHANGE_OF_SITE', { proposedSiteAddress: '66 Demonstration Road, Pune' });
  const scheduler = await as('ro.west');
  const meta = await scheduler.get('/meta');
  const start = new Date(Date.parse(meta.businessTime) + 2 * 86400_000);
  start.setUTCHours(4, 30, 0, 0);
  const slot = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * 3600_000).toISOString(),
    mode: 'PHYSICAL', timezone: 'Asia/Kolkata', specialism: 'ENGINEERING' };
  const suggestions = await scheduler.get(`/evc/applications/${h}/suggestions?${new URLSearchParams(slot)}`);
  const expertIds = suggestions.rows.filter((x: any) => x.selectable).slice(0,2).map((x: any) => x.userId);
  await scheduler.command(h, 'PROPOSE_VISIT', { ...slot, expertIds, reason: 'Prepared synthetic visit for the M4 demonstration.' });
  const hv = await scheduler.get(`/applications/${h}`);
  const visit = hv.evc.visits[0];
  await scheduler.command(h, 'CONFIRM_VISIT', { visitId: visit.id, visitExpectedVersion: visit.row_version, reason: 'Confirm synthetic expert reservations for the M4 demonstration.' });
  await label(h, 'Pune · confirmed EVC visit · institution acknowledges, evc1/evc2 confirm participation');

  // 9. A verified expired lease remains current while its renewal waits for human verification.
  const i = await submit('inst.west','EXTENSION_OF_APPROVAL');
  await scrutinise(i,'RECOMMEND_APPROVAL_WITH_CONDITIONS');
  await (await as('authority')).command(i,'RECORD_DECISION',{outcome:'APPROVED_WITH_CONDITIONS',reason:'Synthetic approval subject to a reviewed registered lease renewal.',conditions:[{text:'Submit a renewed synthetic campus lease deed',dueInDays:3}]});
  const institution = await as('inst.west'), reviewer = await as('ro.west');
  const verifierId = (await reviewer.get('/me')).user.id;
  const obligation = await reviewer.command(i,'CREATE_OBLIGATION',{conditionIndex:0,requiredDocumentType:'LEASE_DEED',verifierUserId:verifierId,reason:'Track the exact recorded renewal condition for the M5 demonstration.'});
  const syntheticPdf = (text:string) => `%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n% ${text}\ntrailer << >>\n%%EOF\n`;
  const old = await institution.upload(i,{title:'Synthetic campus lease deed',documentType:'LEASE_DEED',visibility:'INSTITUTION'},syntheticPdf('Expired synthetic lease; no real institution data'),'synthetic-expired-lease.pdf');
  const previousDay = new Date(Date.parse(meta.businessTime)-86400_000).toISOString().slice(0,10);
  const review = await reviewer.command(i,'REVIEW_DOCUMENT_METADATA',{versionId:old.versionId,values:{institutionName:'Synthetic Pune institution',validThrough:previousDay,page:1,excerpt:'Synthetic expired validity date'},reason:'Confirmed the synthetic expired date against the demonstration document.'});
  await reviewer.command(i,'VERIFY_DOCUMENT',{versionId:old.versionId,outcome:'ACCEPT',metadataReviewId:review.result.metadataReviewId,reason:'Record the previously verified expired synthetic lease in its history.'});
  let iv = await institution.get(`/applications/${i}`);
  const replacement = await institution.upload(i,{documentId:old.documentId,documentExpectedVersion:iv.documents[0].row_version,title:'Synthetic campus lease deed',documentType:'LEASE_DEED',visibility:'INSTITUTION'},syntheticPdf('Synthetic replacement awaiting human metadata review'),'synthetic-lease-renewal.pdf');
  iv = await institution.get(`/applications/${i}`);
  await institution.command(i,'SUBMIT_EVIDENCE',{obligationId:obligation.result.obligationId,obligationExpectedVersion:iv.obligations[0].row_version,versionIds:[replacement.versionId],reason:'Submit this exact synthetic replacement version against the renewal condition.'});
  await label(i,'Pune · M5 renewal · expired verified lease + on-time replacement receipt awaiting review (ro.west)');

  console.log('Demo cases created:\n  ' + made.join('\n  '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
