import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool, one, q } from '../../db.js';
import { requireActor } from '../../http/context.js';
import { applicationScopeSql, has } from '../identity/permissions.js';
import { now } from '../../lib/clock.js';

export async function complianceRoutes(app:FastifyInstance) {
  app.get('/obligations',async(req)=>{
    const actor=requireActor(req), f=z.object({state:z.enum(['OPEN','EVIDENCE_SUBMITTED','UNDER_VERIFICATION','FULFILLED','CLOSED_WITH_AUTHORISED_REASON']).optional(),assigned:z.enum(['true','false']).optional(),page:z.coerce.number().int().positive().default(1)}).parse(req.query);
    const params:unknown[]=[]; let scope=applicationScopeSql(actor,params);
    if(f.state) {params.push(f.state);scope+=` AND o.state = $${params.length}`;}
    if(f.assigned==='true') {params.push(actor.userId);scope+=` AND o.verifier_user_id = $${params.length}`;}
    const base=`FROM obligations o JOIN applications a ON a.id = o.application_id JOIN institutions i ON i.id = a.institution_id JOIN users u ON u.id = o.verifier_user_id WHERE ${scope}`;
    const count=await one(getPool(),`SELECT count(*)::int AS n ${base}`,params);
    const rows=await q(getPool(),`SELECT o.id,o.application_id,a.app_no,i.name AS institution,o.condition_text,o.state,u.name AS verifier,
      (SELECT current_due_at FROM deadlines d WHERE d.subject_id = o.id AND d.clock_type = 'OBLIGATION_SUBMISSION' ORDER BY created_at DESC LIMIT 1) AS submission_due_at,
      (SELECT current_due_at FROM deadlines d WHERE d.subject_id = o.current_submission_id AND d.clock_type = 'VERIFICATION' AND d.state = 'ACTIVE' LIMIT 1) AS verification_due_at
      ${base} ORDER BY o.created_at,o.id LIMIT 50 OFFSET ${(f.page-1)*50}`,params);
    return {total:count.n,page:f.page,rows,refreshedAt:now()};
  });
  app.get('/documents',async(req)=>{
    const actor=requireActor(req), f=z.object({pending:z.enum(['true','false']).optional(),page:z.coerce.number().int().positive().default(1)}).parse(req.query);
    const params:unknown[]=[]; let scope=applicationScopeSql(actor,params);
    if(!has(actor,'INTERNAL_NOTES_VIEW')) scope+=" AND r.visibility = 'INSTITUTION'";
    if(f.pending==='true') scope+=' AND dv.id IS NULL';
    const base=`FROM document_records r JOIN applications a ON a.id = r.application_id JOIN document_versions v ON v.id = r.latest_version_id
      LEFT JOIN document_verifications dv ON dv.version_id = v.id WHERE ${scope}`;
    const total=await one(getPool(),`SELECT count(*)::int AS n ${base}`,params);
    return {total:total.n,page:f.page,rows:await q(getPool(),`SELECT r.id,r.application_id,a.app_no,r.title,r.document_type,r.visibility,v.id AS version_id,v.version_no,v.received_at,
      COALESCE(dv.outcome,'PENDING_VERIFICATION') AS review_state ${base} ORDER BY v.received_at DESC,r.id LIMIT 50 OFFSET ${(f.page-1)*50}`,params),refreshedAt:now()};
  });
}
