import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, getPool, one, q, withTx } from '../../db.js';
import { config } from '../../config.js';
import { realNow } from '../../lib/clock.js';
import { sha256 } from '../../lib/crypto.js';
import { actionContext, idempotencyKey, requireActor, requireCapability } from '../../http/context.js';
import { withIdempotency } from '../../http/idempotency.js';
import { has } from '../identity/permissions.js';
import { assertVersion, bumpVersion, loadVisibleApplication } from '../applications/service.js';
import { loadCaseContext } from '../applications/commands.js';
import { recordAudit } from '../audit/audit.js';
import { emitEvent } from '../outbox/outbox.js';
import { uploadSchema } from './schema.js';
import { ingestUpload } from './storage.js';
import { DEFAULT_LIMITS } from './uploadCheck.js';
import { checkedBytes, documentEvent, documentStorage, documentsForCase, UPLOAD_LOCK, visibleRecord, visibleVersion } from './service.js';

export async function documentRoutes(app:FastifyInstance) {
  app.get<{Params:{id:string}}>('/applications/:id/documents',async(req)=>{
    const actor=requireActor(req); return {rows:await documentsForCase(getPool(),actor,req.params.id)};
  });
  app.post<{Params:{id:string}}>('/applications/:id/documents/uploads',async(req)=>{
    const actor=requireCapability(req,'EVIDENCE_UPLOAD');
    await loadVisibleApplication(getPool(),actor,req.params.id);
    const parts=req.parts({limits:{fileSize:config.maxUploadBytes,files:1,fields:1,parts:2}});
    let bytes:Buffer|undefined, filename='', raw:unknown;
    for await(const part of parts) {
      if(part.type==='file') {if(part.fieldname!=='file') throw new AppError(422,'UPLOAD_FIELD','Expected a single file field'); bytes=await part.toBuffer(); filename=part.filename;}
      else {if(part.fieldname!=='metadata') throw new AppError(422,'UPLOAD_FIELD','Expected metadata JSON'); try{raw=JSON.parse(String(part.value));}catch{throw new AppError(422,'UPLOAD_METADATA','Metadata must be JSON');}}
    }
    if(!bytes) throw new AppError(422,'UPLOAD_REQUIRED','Choose a file'); const input=uploadSchema.parse(raw);
    const ctx=actionContext(req), storage=documentStorage(); let promoted:string|null=null;
    try {
      return await withTx(async(tx)=>{
        await tx.query('SELECT pg_advisory_xact_lock($1)',[UPLOAD_LOCK]);
        const result=await withIdempotency(tx,actor.userId,idempotencyKey(req),`DOCUMENT_UPLOAD:${req.params.id}`,{...input,sha256:sha256(bytes!),filename},async()=>{
          const c=await loadCaseContext(tx,actor,req.params.id,true); assertVersion(c.app,input.expectedVersion);
          if(!c.policy?.doc.compliance?.documentTypes.some(t=>t.code===input.documentType)) throw new AppError(422,'DOCUMENT_TYPE','Choose a document type from the pinned policy');
          if(input.visibility==='INTERNAL'&&!has(actor,'INTERNAL_NOTES_VIEW')) throw new AppError(403,'INTERNAL_DOCUMENT','Your grant cannot create internal documents');
          let record:any;
          if(input.documentId) {
            record=await visibleRecord(tx,actor,input.documentId,c.app.id);
            assertVersion(record,input.documentExpectedVersion??0);
            if(record.document_type!==input.documentType || record.visibility!==input.visibility) throw new AppError(422,'DOCUMENT_IDENTITY','A replacement must keep the document type and visibility');
          } else record=await one(tx,'INSERT INTO document_records(application_id,institution_id,document_type,title,visibility,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[c.app.id,c.app.institution_id,input.documentType,input.title,input.visibility,actor.userId,ctx.at]);
          const ingest=await ingestUpload(storage,bytes!,filename,{...DEFAULT_LIMITS,maxBytes:config.maxUploadBytes});
          if(!ingest.accepted) throw new AppError(422,'UPLOAD_REJECTED','The file failed upload checks',ingest.inspection.problems);
          promoted=ingest.storageKey;
          const prev=record.latest_version_id?await one(tx,'SELECT version_no FROM document_versions WHERE id = $1',[record.latest_version_id]):null;
          const v=await one(tx,`INSERT INTO document_versions(document_id,version_no,predecessor_id,storage_key,sha256,media_type,size_bytes,filename,page_estimate,declared_metadata,uploaded_by,received_at,application_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[record.id,(prev?.version_no??0)+1,record.latest_version_id,ingest.storageKey,ingest.sha256,ingest.inspection.detectedType,bytes!.length,ingest.inspection.safeFilename,ingest.inspection.pdfPageEstimate,JSON.stringify(input.declaredMetadata),actor.userId,ctx.at,c.app.id]);
          await tx.query('UPDATE document_records SET latest_version_id = $2, row_version = row_version + 1 WHERE id = $1',[record.id,v.id]);
          await documentEvent(tx,ctx,c.app,record.id,'DOCUMENT_UPLOADED','Synthetic document uploaded; pending human metadata review and verification',{versionId:v.id,sha256:ingest.sha256,predecessorId:record.latest_version_id},record.visibility);
          await emitEvent(tx,ctx,'DOCUMENT_UPLOADED','document',record.id,{applicationId:c.app.id,visibility:record.visibility});
          return {documentId:record.id,versionId:v.id,rowVersion:await bumpVersion(tx,c.app.id,ctx.at)};
        });
        await visibleVersion(tx,actor,result.result.versionId,req.params.id); return {...result.result,replayed:result.replayed};
      });
    } catch(err) {
      if(promoted) {
        const key=promoted; const referenced=await q(getPool(),'SELECT 1 FROM document_versions WHERE storage_key = $1',[key]);
        if(!referenced.length) try {await storage.remove('objects',key);} catch {
          await withTx(async(tx)=>{await tx.query('INSERT INTO upload_leases(storage_key,expires_at) VALUES ($1,$2) ON CONFLICT DO NOTHING',[key,realNow()]); await recordAudit(tx,ctx,{entityType:'storage',entityId:key,action:'UPLOAD_CLEANUP_PENDING',reason:'Failed registration cleanup will be retried by storage reconciliation'});});
        }
      }
      throw err;
    }
  });
  app.get<{Params:{id:string}}>('/documents/versions/:id/download',async(req,reply)=>{
    const actor=requireActor(req); const id=z.string().uuid().parse(req.params.id);
    const v=await visibleVersion(getPool(),actor,id); const bytes=await checkedBytes(v);
    reply.header('Content-Disposition',`attachment; filename="${v.filename.replace(/["\\\r\n]/g,'_')}"`);
    reply.header('Content-Type',v.media_type); reply.header('Content-Security-Policy',"sandbox; default-src 'none'"); return reply.send(bytes);
  });
}
