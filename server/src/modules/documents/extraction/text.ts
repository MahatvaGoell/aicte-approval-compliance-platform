import { Worker } from 'node:worker_threads';
import { AppError,ValidationError } from '../../../db.js';
import { detectType } from '../uploadCheck.js';
import { sourceLines } from './lines.js';
import { CandidateLimit,conclude,dateCandidates,initialResult } from './rules.js';
import { emptyResult,limitsSchema,replySchema,type ExtractionResult,type Limits } from './types.js';

const MAX_WORKERS=2;
let active=0;
export interface ExtractOptions {limits?:Partial<Limits>;signal?:AbortSignal}

/** Internal bytes-only primitive: no case writes, storage lookup, fixture labels, URL fetch or OCR. */
export async function extractPdfExpiry(bytes:Uint8Array,options:ExtractOptions={}):Promise<ExtractionResult> {
  const parsed=limitsSchema.safeParse(options.limits??{});
  if(!parsed.success)throw new ValidationError('Invalid extraction limits',parsed.error.flatten());
  const limits=parsed.data;
  if(!(bytes instanceof Uint8Array)||!bytes.length)return emptyResult('INVALID_DOCUMENT','PDF_EMPTY','Supply non-empty local PDF bytes.');
  if(bytes.length>limits.maxBytes)return emptyResult('LIMIT_EXCEEDED','BYTE_LIMIT','PDF byte limit exceeded.');
  if(detectType(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength))!=='application/pdf')return emptyResult('INVALID_DOCUMENT','PDF_SIGNATURE','Input is not a supported PDF.');
  if(options.signal?.aborted)return emptyResult('CANCELLED','CANCELLED','Extraction was cancelled.');
  if(active>=MAX_WORKERS)throw new AppError(503,'EXTRACTION_BUSY','The bounded PDF worker pool is busy; retry later.');
  // Copy just the supplied view; the worker may detach its copy, never the caller's Buffer or shared backing data.
  const copy=new Uint8Array(bytes);active++;
  let worker:Worker;
  try {worker=new Worker(new URL('./pdf-worker.mjs',import.meta.url),{workerData:{bytes:copy,limits},transferList:[copy.buffer],execArgv:[],
    resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});}
  catch {active--;return emptyResult('INVALID_DOCUMENT','WORKER_START_FAILED','The PDF worker could not start.');}
  return new Promise(resolve=>{
    let settled=false;
    const finish=async(result:ExtractionResult)=>{
      if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);
      try {await worker.terminate();}catch{/* Already exited; no result/error text is exposed. */}finally {active--;resolve(result);}
    };
    const cancel=()=>void finish(emptyResult('CANCELLED','CANCELLED','Extraction was cancelled.'));
    const timer=setTimeout(()=>void finish(emptyResult('LIMIT_EXCEEDED','TIME_LIMIT','PDF extraction exceeded its time budget.')),limits.timeoutMs);
    options.signal?.addEventListener('abort',cancel,{once:true});
    worker.once('message',(message:unknown)=>{
      const parsed=replySchema.safeParse(message);
      if(!parsed.success){void finish(emptyResult('INVALID_DOCUMENT','WORKER_PROTOCOL','The PDF worker returned invalid data.'));return;}
      const reply=parsed.data;
      if(!reply.ok) {
        const outcome=['PAGE_LIMIT','ITEM_LIMIT','TEXT_LIMIT'].includes(reply.code)?'LIMIT_EXCEEDED':'INVALID_DOCUMENT';
        void finish(emptyResult(outcome,reply.code,reply.code==='PDF_ENCRYPTED'?'Encrypted PDFs are unsupported.':'PDF text could not be safely extracted.'));return;
      }
      try {
        const result=initialResult();
        result.pages=reply.pages.map(page=>({page:page.page,width:page.width,height:page.height,rotation:page.rotation,lines:sourceLines(page)}));
        result.ocrRequiredPages=reply.pages.filter(p=>p.unsupported||!p.spans.some(s=>/[\p{L}\p{N}]/u.test(s.text))).map(p=>p.page);
        result.candidates=dateCandidates(result.pages.flatMap(p=>p.lines),limits.maxCandidates);
        void finish(conclude(result));
      } catch(error) {void finish(emptyResult(error instanceof CandidateLimit?'LIMIT_EXCEEDED':'INVALID_DOCUMENT',error instanceof CandidateLimit?'CANDIDATE_LIMIT':'TEXT_PROCESSING_FAILED','PDF text processing could not complete within the supported contract.'));}
    });
    worker.once('error',error=>void finish(emptyResult(error.message.includes('memory')?'LIMIT_EXCEEDED':'INVALID_DOCUMENT','WORKER_FAILED','The bounded PDF worker failed.')));
    worker.once('exit',()=>{if(!settled)void finish(emptyResult('INVALID_DOCUMENT','WORKER_EXITED','The PDF worker exited without a result.'));});
  });
}
