// Fixture ground-truth contract only. Never imported by an extractor or API to supply suggested values.
import { z } from 'zod';
import { dateOnly } from '../../src/modules/documents/schema.js';

const box = z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().positive(), z.number().finite().positive()])
  .refine(([x0,y0,x1,y1])=>x0<x1&&y0<y1,'Rectangle must have positive area');
const candidate = z.object({
  text:z.string().min(1), role:z.enum(['ISSUE','EXECUTION','REGISTRATION','EXPIRY','REFERENCE']),
  value:dateOnly.nullable(),validity:z.enum(['VALID','INVALID','AMBIGUOUS']),alternatives:z.array(dateOnly),
  page:z.number().int().positive(),excerpt:z.string().min(1),bbox:box,excerptBbox:box,
}).strict().superRefine((v,ctx)=>{
  if(!v.excerpt.includes(v.text))ctx.addIssue({code:'custom',message:'Date literal must exist in the source excerpt'});
  if(v.validity==='VALID'?(v.value===null||v.alternatives.length!==0):(v.value!==null))
    ctx.addIssue({code:'custom',message:'Candidate value disagrees with its validity'});
  if(v.validity==='AMBIGUOUS'?new Set(v.alternatives).size<2:v.alternatives.length!==0)
    ctx.addIssue({code:'custom',message:'Ambiguous dates need at least two distinct alternatives; other dates need none'});
});
const fixture = z.object({
  id:z.string().regex(/^expiry-\d{2}$/),file:z.string().regex(/^pdfs\/expiry-\d{2}\.pdf$/),
  templateFamily:z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),split:z.enum(['development','heldout']),kind:z.enum(['text','scan']),
  tags:z.array(z.string().min(1)).min(1),pageCount:z.number().int().min(1).max(10),pageSize:z.tuple([z.number().positive(),z.number().positive()]),
  expected:z.object({state:z.enum(['UNAMBIGUOUS','AMBIGUOUS','NOT_FOUND']),expiry:dateOnly.nullable()}).strict(),
  candidates:z.array(candidate),scan:z.object({rotationDegrees:z.number().finite().min(-10).max(10),contrast:z.number().positive().max(1)}).strict().nullable(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(10*1024*1024),
}).strict().superRefine((v,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.file!==`pdfs/${v.id}.pdf`)issue('Fixture path must match its stable ID');
  if((v.kind==='scan')!==(v.scan!==null))issue('Scan settings must exist only on scans');
  if(v.expected.state==='UNAMBIGUOUS'?(v.expected.expiry===null):(v.expected.expiry!==null))issue('Only unambiguous fixtures have a gold expiry');
  const validExpiries=v.candidates.filter(c=>c.role==='EXPIRY'&&c.validity==='VALID');
  if(v.expected.state==='UNAMBIGUOUS'&&!validExpiries.some(c=>c.value===v.expected.expiry))issue('Gold expiry must cite a valid expiry candidate');
  if(v.expected.state==='UNAMBIGUOUS'&&(new Set(validExpiries.map(c=>c.value)).size!==1||v.candidates.some(c=>c.role==='EXPIRY'&&c.validity==='AMBIGUOUS')))
    issue('Conflicting or ambiguous expiry candidates cannot have an unambiguous gold value');
  if(v.expected.state==='NOT_FOUND'&&validExpiries.length)issue('Not-found fixtures cannot contain a labelled valid expiry');
  for(const c of v.candidates) {
    if(c.page>v.pageCount)issue('Candidate page is outside the PDF');
    for(const b of [c.bbox,c.excerptBbox])if(b[2]>v.pageSize[0]||b[3]>v.pageSize[1])issue('Rectangle is outside the page');
    if(c.bbox[0]<c.excerptBbox[0]-.01||c.bbox[1]<c.excerptBbox[1]-.01||c.bbox[2]>c.excerptBbox[2]+.01||c.bbox[3]>c.excerptBbox[3]+.01)
      issue('Date rectangle must fit inside its source excerpt');
  }
});

export const extractionManifestSchema=z.object({
  schemaVersion:z.literal(1),synthetic:z.literal(true),provenance:z.literal('DEMO_ASSUMPTION'),
  coordinateSystem:z.object({origin:z.literal('TOP_LEFT'),unit:z.literal('PDF_POINT'),bbox:z.literal('x0,y0,x1,y1'),pageIndexBase:z.literal(1)}).strict(),
  generation:z.object({fixedDates:z.literal(true),pdfInvariant:z.literal(true),scanDpi:z.literal(144),packages:z.record(z.string())}).strict(),
  fixtures:z.array(fixture).min(20).max(30),
}).strict().superRefine((v,ctx)=>{
  const ids=new Set<string>(),files=new Set<string>(),families=new Map<string,string>();
  for(const f of v.fixtures) {
    if(ids.has(f.id)||files.has(f.file))ctx.addIssue({code:'custom',message:'Duplicate fixture identity/path'});
    ids.add(f.id);files.add(f.file);
    if(families.has(f.templateFamily)&&families.get(f.templateFamily)!==f.split)
      ctx.addIssue({code:'custom',message:'A template family cannot cross development and heldout splits'});
    families.set(f.templateFamily,f.split);
  }
});
export type ExtractionManifest=z.infer<typeof extractionManifestSchema>;
