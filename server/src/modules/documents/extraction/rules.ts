import { union } from './lines.js';
import { emptyResult,type Candidate,type ExtractionResult,type Role,type SourceLine } from './types.js';

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthPattern='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const datePattern=new RegExp(`\\b(?:\\d{4}\\s*-\\s*\\d{1,2}\\s*-\\s*\\d{1,2}|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{4}|\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${monthPattern}\\.?[\\s,-]+\\d{4}|${monthPattern}\\.?[\\s-]+\\d{1,2}(?:st|nd|rd|th)?[\\s,-]+\\d{4})\\b`,'gi');

/** Pure calendar validation: no current date, locale choice, or rollover normalization. */
function iso(year:number,month:number,day:number):string|null {
  const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1000&&year<=9999&&month>=1&&month<=12&&day>=1&&day<=days[month-1]
    ?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
}
function dateValues(raw:string):string[] {
  let match=/^(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/.exec(raw);
  if(match)return [iso(+match[1],+match[2],+match[3])].filter((x):x is string=>!!x);
  match=/^(\d{1,2})\s*([/.-])\s*(\d{1,2})\s*([/.-])\s*(\d{4})$/.exec(raw);
  if(match) {
    if(match[2]!==match[4])return [];
    return [...new Set([iso(+match[5],+match[3],+match[1]),iso(+match[5],+match[1],+match[3])].filter((x):x is string=>!!x))].sort();
  }
  const parts=raw.replace(/(\d)(st|nd|rd|th)\b/gi,'$1').split(/[\s,.-]+/).filter(Boolean);
  if(parts.length!==3)return [];
  const wordFirst=/^[A-Za-z]/.test(parts[0]),word=wordFirst?parts[0]:parts[1];
  const month=MONTHS.findIndex(m=>m.slice(0,3)===word.toLowerCase().slice(0,3))+1;
  return [iso(+parts[2],month,+(wordFirst?parts[1]:parts[0]))].filter((x):x is string=>!!x);
}

const LABELS:Array<[Role,RegExp]>=[
  ['EXPIRY',/\b(?:valid\s+(?:till|until|up\s+to|through)|expires\s+on|expiry(?:\s+date)?|expiration(?:\s+date)?)\s*[:\-]?\s*$/i],
  ['ISSUE',/\b(?:issued\s+on|issue\s+date|date\s+of\s+issue|dated)\s*[:\-]?\s*$/i],
  ['EXECUTION',/\b(?:executed\s+on|execution\s+date)\s*[:\-]?\s*$/i],
  ['REGISTRATION',/\b(?:registered\s+on|registration\s+date)\s*[:\-]?\s*$/i],
  ['REFERENCE',/\b(?:previous\s+review|review\s+date|reference\s+date)\s*[:\-]?\s*$/i],
];
function labelRole(prefix:string):Role {
  // A bounded source prefix immediately before the date, not an instruction or arbitrary keyword anywhere.
  const tail=prefix.slice(-80);
  return LABELS.find(([,pattern])=>pattern.test(tail))?.[0]??'UNKNOWN';
}
export class CandidateLimit extends Error {}
export function dateCandidates(lines:SourceLine[],maxCandidates:number):Candidate[] {
  const candidates:Candidate[]=[];
  for(let index=0;index<lines.length;index++) {
    const line=lines[index];
    for(const match of line.text.matchAll(datePattern)) {
      if(candidates.length>=maxCandidates)throw new CandidateLimit('Too many date candidates');
      const start=match.index,end=start+match[0].length,values=dateValues(match[0]);
      let role=labelRole(line.text.slice(0,start)),evidence:SourceLine|null=role==='UNKNOWN'?null:line;
      const previous=lines[index-1];
      // Label-only preceding line, close vertically and aligned to this value. No cross-page/column search.
      if(role==='UNKNOWN'&&start<=2&&previous&&previous.page===line.page&&line.layoutBox[1]-previous.layoutBox[3]>=-1
        &&line.layoutBox[1]-previous.layoutBox[3]<=Math.max(line.height,previous.height)*1.5
        &&Math.abs(line.layoutBox[0]-previous.layoutBox[0])<=Math.max(12,line.height)) {
        role=labelRole(previous.text);if(role!=='UNKNOWN')evidence=previous;
      }
      const boxes=line.runs.filter(r=>r.start<end&&r.end>start).map(r=>r.bbox);
      if(!boxes.length)continue; // Never manufacture a date box without a contributing PDF text item.
      candidates.push({field:role==='EXPIRY'?'validThrough':role==='ISSUE'?'issuedOn':null,role,
        value:values.length===1?values[0]:null,raw:match[0],validity:!values.length?'INVALID':values.length===1?'VALID':'AMBIGUOUS',
        alternatives:values.length>1?values:[],page:line.page,excerpt:line.text,bbox:union(boxes),excerptBbox:line.bbox,
        method:'text',ambiguous:values.length>1,bboxPrecision:'TEXT_ITEM',
        roleEvidence:evidence?{excerpt:evidence.text,page:evidence.page,bbox:evidence.bbox}:null});
    }
  }
  return candidates;
}

export function conclude(result:ExtractionResult):ExtractionResult {
  const finish=(outcome:ExtractionResult['outcome'],code:string,message:string,value:string|null=null):ExtractionResult=>
    ({...result,outcome,validThrough:value,reasons:[{code,message}]});
  if(result.ocrRequiredPages.length)return finish('OCR_REQUIRED','INCOMPLETE_TEXT_LAYER','Some pages have no usable supported text layer; review/OCR is needed before suggesting an expiry.');
  const expiry=result.candidates.filter(c=>c.role==='EXPIRY'),valid=expiry.filter(c=>c.validity==='VALID'),dates=[...new Set(valid.map(c=>c.value!))];
  if(expiry.some(c=>c.validity==='AMBIGUOUS'))return finish('AMBIGUOUS','DATE_ORDER_UNRESOLVED','Numeric date order is unresolved; no locale convention was assumed.');
  if(dates.length>1)return finish('AMBIGUOUS','CONFLICTING_EXPIRIES','Multiple distinct expiry dates are present.');
  if(dates.length&&expiry.some(c=>c.validity==='INVALID'))return finish('AMBIGUOUS','INVALID_EXPIRY_ALONGSIDE_VALID','An invalid expiry entry also needs review.');
  if(!dates.length)return finish('NOT_FOUND',expiry.length?'INVALID_EXPIRY_DATE':'NO_LABELLED_EXPIRY','No unambiguous valid expiry was found; other date roles are not substituted.');
  const issues=result.candidates.filter(c=>c.role==='ISSUE');
  if(issues.some(c=>c.validity!=='VALID'))return finish('AMBIGUOUS','ISSUE_DATE_UNCERTAIN','The source issue date needs review before chronology can be checked.');
  if(issues.some(c=>c.value!>dates[0]))return finish('AMBIGUOUS','EXPIRY_BEFORE_ISSUE','The source expiry precedes a recorded issue date.');
  return finish('SUGGESTED','HUMAN_CONFIRMATION_REQUIRED','Source-backed suggestion only; a reviewer must confirm it before use.',dates[0]);
}
export function initialResult():ExtractionResult{return emptyResult('NOT_FOUND','NO_LABELLED_EXPIRY','No expiry has been evaluated.');}
