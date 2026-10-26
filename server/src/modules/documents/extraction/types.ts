import { z } from 'zod';
import { DEFAULT_LIMITS } from '../uploadCheck.js';

export const EXTRACTION_LIMITS=Object.freeze({maxBytes:DEFAULT_LIMITS.maxBytes,maxPages:DEFAULT_LIMITS.maxPdfPages,
  maxItems:100_000,maxItemsPerPage:20_000,maxChars:500_000,maxCharsPerPage:60_000,maxCandidates:200,timeoutMs:10_000});
export type Limits={[K in keyof typeof EXTRACTION_LIMITS]:number};
const limit=(key:keyof Limits)=>z.number().int().positive().max(EXTRACTION_LIMITS[key]).default(EXTRACTION_LIMITS[key]);
export const limitsSchema=z.object({maxBytes:limit('maxBytes'),maxPages:limit('maxPages'),maxItems:limit('maxItems'),
  maxItemsPerPage:limit('maxItemsPerPage'),maxChars:limit('maxChars'),maxCharsPerPage:limit('maxCharsPerPage'),
  maxCandidates:limit('maxCandidates'),timeoutMs:limit('timeoutMs')}).strict();
const bbox=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]);
export type Bbox=z.infer<typeof bbox>;
export const spanSchema=z.object({text:z.string(),bbox,layoutBox:bbox,baseline:z.number().finite(),height:z.number().positive().finite()}).strict();
export const pageSchema=z.object({page:z.number().int().positive(),width:z.number().positive().finite(),height:z.number().positive().finite(),
  rotation:z.number().finite(),unsupported:z.boolean(),spans:z.array(spanSchema).max(EXTRACTION_LIMITS.maxItemsPerPage)}).strict();
export const replySchema=z.discriminatedUnion('ok',[
  z.object({ok:z.literal(true),pages:z.array(pageSchema).max(EXTRACTION_LIMITS.maxPages)}).strict(),
  z.object({ok:z.literal(false),code:z.enum(['PDF_ENCRYPTED','PDF_MALFORMED','PAGE_LIMIT','ITEM_LIMIT','TEXT_LIMIT','UNSUPPORTED_RESOURCES'])}).strict(),
]);
export type PageSource=z.infer<typeof pageSchema>;
export type SourceSpan=z.infer<typeof spanSchema>;
export type Role='EXPIRY'|'ISSUE'|'EXECUTION'|'REGISTRATION'|'REFERENCE'|'UNKNOWN';
export interface SourceLine {page:number;text:string;bbox:Bbox;layoutBox:Bbox;height:number;runs:Array<{start:number;end:number;bbox:Bbox}>}
export interface Candidate {
  field:'validThrough'|'issuedOn'|null;role:Role;value:string|null;raw:string;validity:'VALID'|'INVALID'|'AMBIGUOUS';alternatives:string[];
  page:number;excerpt:string;bbox:Bbox;excerptBbox:Bbox;method:'text';ambiguous:boolean;bboxPrecision:'TEXT_ITEM';
  roleEvidence:null|{excerpt:string;page:number;bbox:Bbox};
}
export type Outcome='SUGGESTED'|'AMBIGUOUS'|'NOT_FOUND'|'OCR_REQUIRED'|'INVALID_DOCUMENT'|'LIMIT_EXCEEDED'|'CANCELLED';
export interface ExtractionResult {
  extractor:'pdfjs-text-v1';provenance:'DEMO_ASSUMPTION';method:'text';confirmed:false;outcome:Outcome;validThrough:string|null;
  candidates:Candidate[];pages:Array<{page:number;width:number;height:number;rotation:number;lines:SourceLine[]}>;
  ocrRequiredPages:number[];reasons:Array<{code:string;message:string}>;
}
export function emptyResult(outcome:Outcome,code:string,message:string):ExtractionResult {
  return {extractor:'pdfjs-text-v1',provenance:'DEMO_ASSUMPTION',method:'text',confirmed:false,outcome,validThrough:null,
    candidates:[],pages:[],ocrRequiredPages:[],reasons:[{code,message}]};
}
