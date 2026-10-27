import {z} from 'zod';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;},'Use a valid calendar date');
const period={programmeCode:z.string().trim().min(1).max(60).optional(),usage:z.string().trim().min(3).max(500).optional(),periodFrom:date,periodTo:date.optional()};
const validPeriod=(x:{periodFrom:string;periodTo?:string})=>!x.periodTo||x.periodTo>=x.periodFrom;
export const facultyClaim=z.object({registrationId:z.string().trim().toUpperCase().regex(/^FAC-DEMO-\d{4,12}$/,'Use a synthetic FAC-DEMO registration ID'),name:z.string().trim().min(2).max(120),...period}).strict().refine(validPeriod,'Period end must follow its start');
export const physicalClaim=z.object({identifier:z.string().trim().min(1).max(120),address:z.string().trim().min(5).max(400),...period}).strict().refine(validPeriod,'Period end must follow its start');
