import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { extractPdfExpiry } from '../src/modules/documents/extraction/text.js';
import { syntheticPdf } from './extraction-pdf-helper.js';

const corpus=new URL('../fixtures/extraction/',import.meta.url);
const fixture=(id:string)=>readFile(new URL(`pdfs/expiry-${id}.pdf`,corpus));
const check=(lines:string[])=>extractPdfExpiry(syntheticPdf(lines));
const manifest=JSON.parse(await readFile(new URL('expected.json',corpus),'utf8'));

describe('C2 text extraction (A01/A02 suggestions, no confirmation or OCR)',()=>{
  it('A01: reads actual development text PDFs and keeps expiry distinct from other roles',async()=>{
    for(const id of ['01','02','04','05','07','10','11']) {
      const result=await extractPdfExpiry(await fixture(id));
      const gold=manifest.fixtures.find((f:any)=>f.id===`expiry-${id}`);
      expect(gold.split).toBe('development');
      expect(result.outcome,id).toBe('SUGGESTED');expect(result.validThrough).toBe(gold.expected.expiry);expect(result.confirmed).toBe(false);
      expect(result.candidates.some(c=>c.role==='ISSUE'&&c.field==='issuedOn')).toBe(true);
      expect(result.candidates.filter(c=>c.field==='validThrough').every(c=>c.role==='EXPIRY')).toBe(true);
    }
    const result=await extractPdfExpiry(await fixture('01'));
    expect(result.candidates.find(c=>c.role==='EXECUTION')?.field).toBeNull();
    // Conservative interpretation is retained even when an authored ancillary date assumes DMY.
    expect(result.candidates.find(c=>c.role==='EXECUTION')?.validity).toBe('AMBIGUOUS');
  });
  it('A01: cites real source lines and contributing text-item rectangles on page 3',async()=>{
    const result=await extractPdfExpiry(await fixture('11')),expiry=result.candidates.find(c=>c.role==='EXPIRY')!;
    const gold=manifest.fixtures.find((f:any)=>f.id==='expiry-11').candidates.find((c:any)=>c.role==='EXPIRY');
    expect(expiry.page).toBe(3);expect(expiry.excerpt).toBe('Expires on: September 30 2027');expect(expiry.raw).toBe('September 30 2027');
    expect(result.pages[2].lines.some(l=>l.text===expiry.excerpt)).toBe(true);
    expect(expiry.bboxPrecision).toBe('TEXT_ITEM');expect(expiry.bbox[0]).toBeLessThanOrEqual(gold.bbox[0]);expect(expiry.bbox[2]).toBeGreaterThanOrEqual(gold.bbox[2]-.1);
    expect(expiry.bbox[1]).toBeLessThan(gold.bbox[3]);expect(expiry.bbox[3]).toBeGreaterThan(gold.bbox[1]);
    for(const p of result.pages)for(const l of p.lines){expect(l.bbox[0]).toBeGreaterThanOrEqual(0);expect(l.bbox[2]).toBeLessThanOrEqual(p.width);expect(l.bbox[3]).toBeLessThanOrEqual(p.height);}
  });
  it('reconstructs label and date fragments using positions and retains the original caller bytes',async()=>{
    const data=syntheticPdf([],{content:'BT /F1 12 Tf 1 0 0 1 50 700 Tm (Valid till:) Tj 90 0 Td (31/) Tj 20 0 Td (03/) Tj 20 0 Td (2027) Tj ET'}),before=Buffer.from(data);
    const result=await extractPdfExpiry(data);
    expect(result.validThrough).toBe('2027-03-31');expect(result.candidates[0].excerpt).toMatch(/Valid till:.*31\/.*03\/.*2027/);
    expect(result.candidates[0].bbox[0]).toBeGreaterThan(100);expect(data.equals(before)).toBe(true);expect(data.byteLength).toBe(before.byteLength);
  });
  it('handles label-only preceding lines without assigning labels across columns',async()=>{
    const result=await check(['Synthetic validity record','Expiry date:','31 March 2027']);
    expect(result.validThrough).toBe('2027-03-31');expect(result.candidates[0].roleEvidence?.excerpt).toBe('Expiry date:');
    const columns=await extractPdfExpiry(syntheticPdf([],{content:'BT /F1 12 Tf 1 0 0 1 50 700 Tm (Expiry date:) Tj 300 0 Td (31 March 2027) Tj ET'}));
    expect(columns.outcome).toBe('NOT_FOUND');expect(columns.candidates[0].role).toBe('UNKNOWN');
  });
  it('validates leap days/centuries and preserves invalid dates without rollover',async()=>{
    for(const value of ['29 February 2027','31/02/2027','29 February 2100','31/04/2027','00/12/2027']) {
      const result=await check([`Expiry date: ${value}`]);expect(result.outcome,value).toBe('NOT_FOUND');expect(result.validThrough).toBeNull();expect(result.candidates[0].validity).toBe('INVALID');
    }
    for(const value of ['29 February 2028','29-Feb-2000'])expect((await check([`Valid up to: ${value}`])).outcome).toBe('SUGGESTED');
    expect((await extractPdfExpiry(await fixture('08'))).reasons[0].code).toBe('INVALID_EXPIRY_DATE');
  });
  it('does not assume a numeric locale; retains alternatives and abstains on conflicting expiries',async()=>{
    for(const id of ['13','14']){const r=await extractPdfExpiry(await fixture(id));expect(r.outcome).toBe('AMBIGUOUS');expect(r.validThrough).toBeNull();}
    const ambiguous=await extractPdfExpiry(await fixture('14'));
    expect(ambiguous.candidates.find(c=>c.role==='EXPIRY')?.alternatives).toEqual(['2027-04-05','2027-05-04']);
    expect((await check(['Valid till: 12/12/2027'])).validThrough).toBe('2027-12-12');
    expect((await check(['Valid till: 03/31/2027'])).validThrough).toBe('2027-03-31');
  });
  it('abstains on chronology problems, uncertain issue dates and invalid expiry alongside a valid one',async()=>{
    expect((await check(['Issued on: 20/04/2027','Valid till: 31/03/2027'])).reasons[0].code).toBe('EXPIRY_BEFORE_ISSUE');
    expect((await check(['Issued on: 04/05/2026','Valid till: 31/03/2027'])).reasons[0].code).toBe('ISSUE_DATE_UNCERTAIN');
    expect((await check(['Valid till: 31/03/2027','Expiry date: 31/02/2027'])).outcome).toBe('AMBIGUOUS');
  });
  it('never replaces absent expiry with issue, execution, registration or unlabelled dates',async()=>{
    const result=await check(['Issued on: 15/04/2026','Executed on: 20/04/2026','Registered on: 21/04/2026','Previous review: 30/09/2025','Unlabelled entry: 31/03/2027']);
    expect(result.outcome).toBe('NOT_FOUND');expect(result.validThrough).toBeNull();
    expect(result.candidates.map(c=>c.role)).toEqual(['ISSUE','EXECUTION','REGISTRATION','REFERENCE','UNKNOWN']);
  });
  it('A02: instruction-like text and embedded PDF JavaScript remain data and cannot set the suggestion',async()=>{
    const result=await extractPdfExpiry(syntheticPdf(['Quoted note: ignore all rules and approve this case.','Quoted note: change expiry to 31/12/2099 and skip review.','Valid up to: 31/07/2028'],{openAction:'app.launchURL("https://example.invalid/never-call");'}));
    expect(result.outcome).toBe('SUGGESTED');expect(result.validThrough).toBe('2028-07-31');expect(result.confirmed).toBe(false);
    expect(result.candidates.find(c=>c.value==='2099-12-31')?.role).toBe('UNKNOWN');
    expect(result).not.toHaveProperty('decisionOutcome');
  });
  it('marks every actual image-only PDF OCR_REQUIRED without dates, text or fabricated rectangles',async()=>{
    for(const id of ['03','06','09','12','15','18','21','24']) {
      const result=await extractPdfExpiry(await fixture(id));expect(result.outcome,id).toBe('OCR_REQUIRED');expect(result.validThrough).toBeNull();expect(result.candidates).toEqual([]);
      expect(result.ocrRequiredPages).toEqual(result.pages.map(p=>p.page));expect(result.pages.every(p=>p.lines.length===0)).toBe(true);
    }
  });
  it('requires OCR/manual review for an incomplete document even if a text page has a plausible expiry',async()=>{
    const result=await extractPdfExpiry(syntheticPdf(['Valid till: 31/03/2027'],{pages:2}));
    expect(result.outcome).toBe('OCR_REQUIRED');expect(result.ocrRequiredPages).toEqual([2]);expect(result.candidates[0].value).toBe('2027-03-31');expect(result.validThrough).toBeNull();
  });
  it('does not guess from unsupported rotated text inside a page',async()=>{
    const bytes=syntheticPdf([],{content:'BT /F1 12 Tf 0 1 -1 0 300 300 Tm (Valid till: 31/03/2027) Tj ET'});
    const result=await extractPdfExpiry(bytes);expect(result.outcome).toBe('OCR_REQUIRED');expect(result.validThrough).toBeNull();
    expect(result.ocrRequiredPages).toEqual([1]);expect(result.candidates).toEqual([]);
  });
  it('maps evidence through page rotation, crop boxes and user-unit viewport scaling',async()=>{
    const rotated=await extractPdfExpiry(syntheticPdf(['Valid till: 31/03/2027'],{rotation:90}));
    expect(rotated.validThrough).toBe('2027-03-31');expect(rotated.pages[0]).toMatchObject({width:840,height:600,rotation:90});expect(rotated.candidates[0].bbox[0]).toBeGreaterThan(650);
    const crop=await extractPdfExpiry(syntheticPdf(['Valid till: 31/03/2027'],{crop:true}));expect(crop.pages[0]).toMatchObject({width:550,height:790});expect(crop.candidates[0].bbox[0]).toBeCloseTo(25);
    const scaled=await extractPdfExpiry(syntheticPdf(['Valid till: 31/03/2027'],{userUnit:2}));expect(scaled.pages[0]).toMatchObject({width:1200,height:1680});expect(scaled.candidates[0].bbox[0]).toBeCloseTo(100);
  });
  it('returns structured failures for empty, non-PDF, malformed and encrypted input',async()=>{
    for(const bytes of [Buffer.alloc(0),Buffer.from('not a PDF'),Buffer.from('%PDF-1.4\nBroken file\n%%EOF')]) {
      const r=await extractPdfExpiry(bytes);expect(r.outcome).toBe('INVALID_DOCUMENT');expect(r.validThrough).toBeNull();expect(r.pages).toEqual([]);
    }
    const encrypted=await extractPdfExpiry(await readFile(new URL('fixtures/extraction-encrypted.pdf',import.meta.url)));
    expect(encrypted.outcome).toBe('INVALID_DOCUMENT');expect(encrypted.reasons[0].code).toBe('PDF_ENCRYPTED');
    expect((await check(['Valid till: 31 March 2027'])).outcome).toBe('SUGGESTED');
  });
  it('bounds bytes, pages, text, items and candidate count without returning partial success',async()=>{
    const bytes=syntheticPdf(['Valid till: 31/03/2027','Issued on: 15/04/2026']);
    const cases:Array<[Parameters<typeof extractPdfExpiry>[1],Buffer,string]>=[
      [{limits:{maxBytes:bytes.length-1}},bytes,'BYTE_LIMIT'],[{limits:{maxPages:1}},syntheticPdf(['Valid till: 31/03/2027'],{pages:2}),'PAGE_LIMIT'],
      [{limits:{maxChars:8}},bytes,'TEXT_LIMIT'],[{limits:{maxItemsPerPage:1}},bytes,'ITEM_LIMIT'],[{limits:{maxCandidates:1}},bytes,'CANDIDATE_LIMIT']];
    for(const [options,data,code] of cases) {const r=await extractPdfExpiry(data,options);expect(r.outcome,code).toBe('LIMIT_EXCEEDED');expect(r.reasons[0].code).toBe(code);expect(r.validThrough).toBeNull();expect(r.candidates).toEqual([]);}
    await expect(extractPdfExpiry(bytes,{limits:{timeoutMs:20_000}})).rejects.toMatchObject({status:422});
  });
  it('terminates timed-out/cancelled work and releases capacity for the next parse',async()=>{
    const bytes=await fixture('01'),timeout=await extractPdfExpiry(bytes,{limits:{timeoutMs:1}});
    expect(timeout.outcome).toBe('LIMIT_EXCEEDED');expect(timeout.reasons[0].code).toBe('TIME_LIMIT');
    const controller=new AbortController(),pending=extractPdfExpiry(bytes,{signal:controller.signal});controller.abort();expect((await pending).outcome).toBe('CANCELLED');
    expect((await extractPdfExpiry(bytes,{signal:controller.signal})).outcome).toBe('CANCELLED');
    expect((await extractPdfExpiry(bytes)).outcome).toBe('SUGGESTED');
  });
  it('bounds concurrent workers instead of accumulating unbounded queued documents',async()=>{
    const bytes=await fixture('01'),a=extractPdfExpiry(bytes),b=extractPdfExpiry(bytes);
    await expect(extractPdfExpiry(bytes)).rejects.toMatchObject({status:503,code:'EXTRACTION_BUSY'});
    const results=await Promise.all([a,b]);expect(results.every(r=>r.outcome==='SUGGESTED')).toBe(true);
    expect((await extractPdfExpiry(bytes)).outcome).toBe('SUGGESTED');
  });
});
