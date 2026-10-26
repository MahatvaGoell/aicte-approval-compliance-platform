import { z } from 'zod';

export const SOURCE_SYSTEM = 'MOCK_PORTAL' as const;
export const MAPPING_VERSION = 'mock-portal-v1';
export const MOCK_NOTICE = 'Mock adapter; synthetic data only. Not connected to AICTE or NSWS. Source mirror status is not a local approval decision.';
export const SOURCE_STATES = ['SOURCE_RECEIVED','SOURCE_PROCESSING','SOURCE_REPORTED_COMPLETE'] as const;
const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/);
export const identitySchema = z.object({externalId:identifier,eventId:identifier,revision:z.number().int().positive().max(2_147_483_647)});
export const sourceRecordSchema = identitySchema.extend({
  institutionCode:z.string().regex(/^DEMO-[A-Za-z0-9-]{1,60}$/),
  sourceUpdatedAt:z.string().datetime({offset:true}),
  fields:z.object({title:z.string().trim().min(3).max(200),statusCode:identifier}).strict(),
}).strict();
export const mappingSchema = z.object({statusCodes:z.record(z.enum(SOURCE_STATES))}).strict();
export const syncSchema = z.object({
  sourceSystem:z.literal(SOURCE_SYSTEM).default(SOURCE_SYSTEM),regionId:z.string().min(1).max(40),
  expectedVersion:z.number().int().min(0),reason:z.string().trim().min(10).max(2000),
  fixture:z.literal('portal-export').optional(),events:z.array(z.unknown()).min(1).max(500).optional(),
}).strict().refine(x=>!(x.fixture&&x.events),{message:'Choose the fixture or inline synthetic events, not both',path:['events']});
export type SyncInput = z.infer<typeof syncSchema>;
export type Outcome = 'ACCEPTED'|'DUPLICATE'|'INVALID'|'RECONCILIATION';
