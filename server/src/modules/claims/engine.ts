export type ResourceKind='FACULTY'|'LAB'|'BUILDING';
export interface DoubleClaimRule {exclusiveKinds:ResourceKind[];sameInstitutionDifferentProgramme:boolean;overlapRule:'INCLUSIVE_DATES';provenance:'DEMO_ASSUMPTION'}
export interface Claim {id:string;kind:ResourceKind;identityKey:string;institutionId:string;applicationId:string;programmeCode:string|null;periodFrom:string;periodTo:string|null}
/** Normalisation is explicit and deterministic; names never participate in identity. */
export const normaliseIdentity=(value:string)=>value.normalize('NFKC').toUpperCase().replace(/[\s\p{P}]+/gu,' ').trim();
export const physicalIdentity=(identifier:string,address:string)=>normaliseIdentity(identifier)+'|'+normaliseIdentity(address);
/** Exact (kind,identityKey), inclusive stored dates, and the pinned exclusivity rule. */
export function findDoubleClaims(claims:Claim[],rule:DoubleClaimRule) {
 const sorted=[...claims].sort((a,b)=>a.id.localeCompare(b.id));const pairs:Array<{claimIds:[string,string];kind:ResourceKind;identityKey:string}>=[];
 for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
  const a=sorted[i],b=sorted[j];
  if(a.kind!==b.kind||a.identityKey!==b.identityKey||!rule.exclusiveKinds.includes(a.kind))continue;
  const exclusive=a.institutionId!==b.institutionId||(rule.sameInstitutionDifferentProgramme&&!!a.programmeCode&&!!b.programmeCode&&a.programmeCode!==b.programmeCode);
  if(!exclusive)continue;
  if(a.periodFrom>(b.periodTo??'9999-12-31')||b.periodFrom>(a.periodTo??'9999-12-31'))continue;
  pairs.push({claimIds:[a.id,b.id],kind:a.kind,identityKey:a.identityKey});
 }
 return pairs;
}
