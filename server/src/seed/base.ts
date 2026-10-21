import type pg from 'pg';
import { canonicalJson, hashPassword, newCorrelationId, sha256 } from '../lib/crypto.js';
import { recordAudit } from '../modules/audit/audit.js';
import { validatePolicy } from '../modules/policy/schema.js';
import { policyV1 } from './policy-v1.js';

// Synthetic reference data. Every institution, person and address here is fictional.
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';

export const REGIONS = [
  { id: 'DEMO-NORTH', name: 'Demo North region (synthetic)' },
  { id: 'DEMO-WEST', name: 'Demo West region (synthetic)' },
  { id: 'DEMO-SOUTH', name: 'Demo South region (synthetic)' },
];

export const INSTITUTIONS = [
  { key: 'pune', permanentId: 'DEMO-1-10001', name: 'Demo Institute of Technology, Pune', address: '12 Demo Road, Hinjawadi', district: 'Pune', state: 'Maharashtra', region: 'DEMO-WEST', type: 'ENGINEERING' },
  { key: 'nagpur', permanentId: 'DEMO-1-10002', name: 'Demo Polytechnic, Nagpur', address: '4 Sample Nagar', district: 'Nagpur', state: 'Maharashtra', region: 'DEMO-WEST', type: 'POLYTECHNIC' },
  { key: 'lucknow', permanentId: 'DEMO-1-20001', name: 'Demo College of Engineering, Lucknow', address: '88 Placeholder Marg', district: 'Lucknow', state: 'Uttar Pradesh', region: 'DEMO-NORTH', type: 'ENGINEERING' },
  { key: 'jaipur', permanentId: 'DEMO-1-20002', name: 'Demo Institute of Pharmacy, Jaipur', address: '3 Fiction Colony', district: 'Jaipur', state: 'Rajasthan', region: 'DEMO-NORTH', type: 'PHARMACY' },
  { key: 'chennai', permanentId: 'DEMO-1-30001', name: 'Demo School of Management, Chennai', address: '21 Example Street', district: 'Chennai', state: 'Tamil Nadu', region: 'DEMO-SOUTH', type: 'MANAGEMENT' },
  { key: 'kochi', permanentId: 'DEMO-1-30002', name: 'Demo Engineering College, Kochi', address: '7 Mock Avenue', district: 'Ernakulam', state: 'Kerala', region: 'DEMO-SOUTH', type: 'ENGINEERING' },
];

export const COMMITTEES = [
  { id: 'SCR-WEST', name: 'Scrutiny Committee — Demo West', kind: 'SCRUTINY', region: 'DEMO-WEST' },
  { id: 'SCR-NORTH', name: 'Scrutiny Committee — Demo North', kind: 'SCRUTINY', region: 'DEMO-NORTH' },
  { id: 'SCR-SOUTH', name: 'Scrutiny Committee — Demo South', kind: 'SCRUTINY', region: 'DEMO-SOUTH' },
  { id: 'EVC-POOL', name: 'Expert Visit Committee pool', kind: 'EVC', region: null },
  { id: 'SAC-1', name: 'Standing Appellate Committee', kind: 'SAC', region: null },
  { id: 'SHC-1', name: 'Standing Hearing Committee', kind: 'SHC', region: null },
];

interface GrantSpec {
  role: string;
  designation?: string;
  institution?: string;
  regions?: string[];
  scopeAll?: boolean;
  committee?: string;
  extra?: string[];
}

export const USERS: Array<{ email: string; name: string; grants: GrantSpec[] }> = [
  { email: 'inst.west@demo.aicte.test', name: 'Asha Kulkarni (demo)', grants: [{ role: 'INSTITUTION_REP', designation: 'Principal', institution: 'pune' }] },
  { email: 'inst.nagpur@demo.aicte.test', name: 'Rohan Deshpande (demo)', grants: [{ role: 'INSTITUTION_REP', designation: 'Principal', institution: 'nagpur' }] },
  { email: 'inst.north@demo.aicte.test', name: 'Vikram Singh (demo)', grants: [{ role: 'INSTITUTION_REP', designation: 'Director', institution: 'lucknow' }] },
  { email: 'inst.south@demo.aicte.test', name: 'Meena Iyer (demo)', grants: [{ role: 'INSTITUTION_REP', designation: 'Director', institution: 'chennai' }] },
  { email: 'ro.west@demo.aicte.test', name: 'R. Patil (demo regional officer)', grants: [{ role: 'REGIONAL_OFFICER', designation: 'Regional Officer (demo mapping)', regions: ['DEMO-WEST'], extra: ['EVC_SCHEDULE'] }] },
  { email: 'ro.north@demo.aicte.test', name: 'S. Verma (demo regional officer)', grants: [{ role: 'REGIONAL_OFFICER', designation: 'Regional Officer (demo mapping)', regions: ['DEMO-NORTH'], extra: ['EVC_SCHEDULE'] }] },
  { email: 'ro.south@demo.aicte.test', name: 'K. Nair (demo regional officer)', grants: [{ role: 'REGIONAL_OFFICER', designation: 'Regional Officer (demo mapping)', regions: ['DEMO-SOUTH'], extra: ['EVC_SCHEDULE'] }] },
  {
    email: 'bureau@demo.aicte.test', name: 'P. Rao (demo bureau officer)',
    grants: [
      { role: 'BUREAU_OFFICER', designation: 'Approval Bureau officer (demo mapping)', scopeAll: true },
      { role: 'AUDITOR', designation: 'Internal review (demo)', scopeAll: true },
    ],
  },
  { email: 'scrutiny.west1@demo.aicte.test', name: 'Dr. A. Joshi (demo scrutiny member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SCR-WEST' }] },
  { email: 'scrutiny.west2@demo.aicte.test', name: 'Dr. N. Shah (demo scrutiny member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SCR-WEST' }] },
  { email: 'scrutiny.north1@demo.aicte.test', name: 'Dr. M. Gupta (demo scrutiny member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SCR-NORTH' }] },
  { email: 'scrutiny.south1@demo.aicte.test', name: 'Dr. L. Pillai (demo scrutiny member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SCR-SOUTH' }] },
  { email: 'evc1@demo.aicte.test', name: 'Prof. E. Banerjee (demo expert)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'EVC-POOL' }] },
  { email: 'evc2@demo.aicte.test', name: 'Prof. F. Menon (demo expert)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'EVC-POOL' }] },
  { email: 'evc3@demo.aicte.test', name: 'Prof. G. Reddy (demo expert)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'EVC-POOL' }] },
  { email: 'evc4@demo.aicte.test', name: 'Prof. H. Das (demo expert)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'EVC-POOL' }] },
  { email: 'sac1@demo.aicte.test', name: 'Justice (Retd.) I. Khan (demo SAC member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SAC-1' }] },
  { email: 'shc1@demo.aicte.test', name: 'Prof. J. Sen (demo SHC member)', grants: [{ role: 'COMMITTEE_MEMBER', committee: 'SHC-1' }] },
  { email: 'authority@demo.aicte.test', name: 'Competent Authority (demo)', grants: [{ role: 'COMPETENT_AUTHORITY', designation: 'Delegated approving authority (demo mapping)', scopeAll: true }] },
  { email: 'policy.admin@demo.aicte.test', name: 'Policy Administrator (demo)', grants: [{ role: 'POLICY_ADMIN' }] },
  { email: 'policy.approver@demo.aicte.test', name: 'Policy Approver (demo)', grants: [{ role: 'POLICY_APPROVER' }] },
  { email: 'admin@demo.aicte.test', name: 'System Administrator (demo)', grants: [{ role: 'SYSTEM_ADMIN' }] },
  { email: 'auditor@demo.aicte.test', name: 'Auditor (demo)', grants: [{ role: 'AUDITOR', scopeAll: true }] },
];

export interface SeedRefs {
  institutions: Record<string, string>;
  users: Record<string, string>;
  policyV1Id: string;
}

/** Inserts reference data, demo users and the published demonstration policy. */
export async function seedBase(tx: pg.PoolClient): Promise<SeedRefs> {
  const at = new Date();
  const ctx = { actor: null, correlationId: newCorrelationId(), at };
  for (const r of REGIONS) await tx.query('INSERT INTO regions (id, name) VALUES ($1,$2)', [r.id, r.name]);
  await tx.query(`INSERT INTO cycles (code, starts_on, ends_on) VALUES ('2026-27','2026-07-01','2027-06-30'), ('2027-28','2027-07-01','2028-06-30')`);

  const institutions: Record<string, string> = {};
  for (const i of INSTITUTIONS) {
    const row = await tx.query(
      `INSERT INTO institutions (aicte_permanent_id, name, address, district, state, region_id, institution_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [i.permanentId, i.name, i.address, i.district, i.state, i.region, i.type],
    );
    institutions[i.key] = row.rows[0].id;
    await tx.query(
      `INSERT INTO institution_contacts (institution_id, name, designation, email, phone) VALUES ($1,$2,'Principal',$3,'+91-00000-00000')`,
      [row.rows[0].id, `Contact at ${i.name}`, `office.${i.key}@demo.aicte.test`],
    );
  }
  for (const c of COMMITTEES) {
    await tx.query('INSERT INTO committees (id, name, kind, region_id) VALUES ($1,$2,$3,$4)', [c.id, c.name, c.kind, c.region]);
  }

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const users: Record<string, string> = {};
  for (const u of USERS) {
    const row = await tx.query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id', [u.email, u.name, passwordHash]);
    users[u.email] = row.rows[0].id;
    for (const g of u.grants) {
      await tx.query(
        `INSERT INTO capability_grants (user_id, role, official_designation, institution_id, region_ids, scope_all, committee_id,
           extra_capabilities, delegation_source, valid_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Demo seed (synthetic)', '2026-01-01')`,
        [users[u.email], g.role, g.designation ?? null, g.institution ? institutions[g.institution] : null, g.regions ?? [],
          g.scopeAll ?? false, g.committee ?? null, g.extra ?? []],
      );
    }
  }

  await tx.query(
    `INSERT INTO policy_sources (id, provenance, issuer, title, academic_year, notes, review_status) VALUES
     ('DEMO-POLICY-NOTE', 'DEMO_ASSUMPTION', 'Project team', 'Demonstration routing, checklist and timing assumptions', '2027-28',
      'Illustrative only. Not an AICTE rule. Replace with reviewed APH clauses before any real use.', 'UNREVIEWED'),
     ('APH-2024-27', 'APH_CLAUSE', 'AICTE', 'Approval Process Handbook 2024-27 (base handbook)', '2024-25 to 2026-27',
      'Registered for reference. Must be read with applicable amendments. No rule in the demo policy cites it yet.', 'UNREVIEWED')`,
  );
  await tx.query(`UPDATE policy_sources SET url = 'https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf' WHERE id = 'APH-2024-27'`);

  const { doc, issues } = validatePolicy(policyV1);
  const errors = issues.filter((i) => i.level === 'error');
  if (!doc || errors.length) throw new Error('Demo policy is invalid: ' + JSON.stringify(errors));
  const policy = await tx.query(
    `INSERT INTO policy_versions (version_no, label, status, document, checksum, effective_from, created_by, published_by, published_at, change_note)
     VALUES (1, 'v1 — demonstration policy', 'PUBLISHED', $1, $2, '2026-01-01', $3, $4, $5, 'Initial demonstration policy (seed)') RETURNING id`,
    [JSON.stringify(doc), sha256(canonicalJson(doc)), users['policy.admin@demo.aicte.test'], users['policy.approver@demo.aicte.test'], at],
  );
  await recordAudit(tx, ctx, {
    entityType: 'policy_version', entityId: policy.rows[0].id, action: 'POLICY_PUBLISHED',
    after: { versionNo: 1, effectiveFrom: '2026-01-01', provenance: 'DEMO_ASSUMPTION' },
    reason: 'Seeded demonstration policy', policyVersionId: policy.rows[0].id,
  });
  await tx.query(`INSERT INTO system_settings (key, value) VALUES ('demo_clock_offset_ms', '0')`);
  return { institutions, users, policyV1Id: policy.rows[0].id };
}
