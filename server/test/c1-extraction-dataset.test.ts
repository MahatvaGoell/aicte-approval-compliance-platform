import { createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';
import { extractionManifestSchema } from '../scripts/extraction/manifest.js';

const root=new URL('../fixtures/extraction/',import.meta.url);
const raw=JSON.parse(await readFile(new URL('expected.json',root),'utf8'));
const copy=()=>structuredClone(raw);

describe('C1 synthetic expiry corpus (A01/A02 ground truth; no extractor yet)',()=>{
  it('retains independent role labels, abstentions and template-separated text/scan coverage',()=>{
    const manifest=extractionManifestSchema.parse(raw),fixtures=manifest.fixtures;
    expect(fixtures).toHaveLength(24);expect(fixtures.filter(f=>f.kind==='text')).toHaveLength(16);expect(fixtures.filter(f=>f.kind==='scan')).toHaveLength(8);
    expect(fixtures.reduce((sum,f)=>sum+f.pageCount,0)).toBe(32);
    expect(new Set(fixtures.map(f=>f.templateFamily)).size).toBe(8);
    expect(fixtures.filter(f=>f.split==='heldout')).toHaveLength(9);
    const byId=(id:string)=>fixtures.find(f=>f.id===id)!;
    expect(byId('expiry-01').candidates.map(c=>c.role)).toEqual(['ISSUE','EXECUTION','EXPIRY']);
    expect(byId('expiry-01').expected.expiry).toBe('2027-03-31');
    for(const id of ['expiry-08','expiry-17','expiry-18','expiry-20','expiry-22'])expect(byId(id).expected).toEqual({state:'NOT_FOUND',expiry:null});
    for(const id of ['expiry-13','expiry-14','expiry-15','expiry-23'])expect(byId(id).expected).toEqual({state:'AMBIGUOUS',expiry:null});
    expect(byId('expiry-19').tags).toContain('instruction-like-text');
    expect(byId('expiry-21').scan).toEqual({rotationDegrees:1.3,contrast:.58});
    expect(byId('expiry-24').candidates.find(c=>c.role==='EXPIRY')?.page).toBe(3);
  });
  it('matches every checked-in PDF to its declared path, byte size and SHA-256',async()=>{
    const manifest=extractionManifestSchema.parse(raw);
    const actual=(await readdir(new URL('pdfs/',root))).sort();
    expect(actual).toEqual(manifest.fixtures.map(f=>f.id+'.pdf').sort());
    for(const f of manifest.fixtures) {
      const data=await readFile(new URL(f.file,root));
      expect(data.length,fileURLToPath(new URL(f.file,root))).toBe(f.bytes);
      expect(createHash('sha256').update(data).digest('hex')).toBe(f.sha256);
      expect(data.subarray(0,5).toString()).toBe('%PDF-');expect(data.subarray(-6).toString().trim()).toBe('%%EOF');
    }
  });
  it('rejects traversal, mismatched identities, non-existent pages and invalid highlight rectangles',()=>{
    const changes=[(m:any)=>{m.fixtures[0].file='../outside.pdf';},(m:any)=>{m.fixtures[0].file='pdfs/expiry-02.pdf';},
      (m:any)=>{m.fixtures[0].candidates[0].page=9;},(m:any)=>{m.fixtures[0].candidates[0].bbox=[1,1,601,20];},
      (m:any)=>{m.fixtures[0].candidates[0].bbox=[100,40,10,20];},(m:any)=>{m.fixtures[0].candidates[0].excerpt='Unrelated source line';}];
    for(const mutate of changes){const m=copy();mutate(m);expect(extractionManifestSchema.safeParse(m).success).toBe(false);}
  });
  it('rejects invented gold dates, invalid calendar labels and guessed ambiguous candidates',()=>{
    const changes=[(m:any)=>{m.fixtures[0].expected.expiry='2027-02-31';},(m:any)=>{m.fixtures[0].expected.expiry='2099-01-01';},
      (m:any)=>{m.fixtures[7].expected.expiry='2027-03-03';},(m:any)=>{m.fixtures[0].expected.state='NOT_FOUND';m.fixtures[0].expected.expiry=null;},
      (m:any)=>{m.fixtures[13].candidates[1].value='2027-05-04';},(m:any)=>{m.fixtures[13].candidates[1].alternatives=['2027-05-04','2027-05-04'];},
      (m:any)=>{m.fixtures[12].expected={state:'UNAMBIGUOUS',expiry:'2027-03-31'};}];
    for(const mutate of changes){const m=copy();mutate(m);expect(extractionManifestSchema.safeParse(m).success).toBe(false);}
  });
  it('rejects duplicate fixtures, leaked template splits and text files mislabeled as scans',()=>{
    const changes=[(m:any)=>{m.fixtures[1]=m.fixtures[0];},(m:any)=>{m.fixtures[1].split='heldout';},
      (m:any)=>{m.fixtures[0].kind='scan';},(m:any)=>{m.fixtures[2].scan=null;},(m:any)=>{m.synthetic=false;}];
    for(const mutate of changes){const m=copy();mutate(m);expect(extractionManifestSchema.safeParse(m).success).toBe(false);}
  });
});
