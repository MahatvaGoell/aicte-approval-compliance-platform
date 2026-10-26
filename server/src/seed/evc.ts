import type { Db } from '../db.js';
import { recordAudit, type ActionContext } from '../modules/audit/audit.js';

export async function seedEvc(tx: Db, ctx: ActionContext, users: Record<string, string>, institutions: Record<string, string>) {
  for (let i = 1; i <= 4; i++) {
    const id = users[`evc${i}@demo.aicte.test`];
    await tx.query(`INSERT INTO expert_profiles(user_id, specialisms, home_region_id, own_institution_id, affiliated_region_ids, directory_complete, eligible, max_visits_per_month)
      VALUES ($1,$2,$3,$4,$5,$6,true,6)`, [id, ['ENGINEERING','GENERAL'], i === 2 ? 'DEMO-NORTH' : 'DEMO-WEST', i === 3 ? institutions.pune : null, i === 2 ? ['DEMO-NORTH'] : [], i !== 4]);
    await tx.query("INSERT INTO expert_availability(expert_user_id, available) VALUES ($1,tstzrange('2026-01-01','2029-01-01','[)'))", [id]);
    await recordAudit(tx, ctx, { entityType: 'expert_profile', entityId: id, action: 'DEMO_EXPERT_SEEDED', reason: 'Synthetic directory; incomplete fourth profile demonstrates information unavailable', after: { provenance: 'DEMO_ASSUMPTION' } });
  }
  await tx.query('INSERT INTO declared_conflicts(expert_user_id, institution_id, reason) VALUES ($1,$2,$3)', [users['evc3@demo.aicte.test'], institutions.nagpur, 'Synthetic declared consultancy conflict']);
}
