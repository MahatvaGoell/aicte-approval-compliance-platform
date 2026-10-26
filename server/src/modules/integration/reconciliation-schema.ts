import { z } from 'zod';
import { reasonSchema } from '../documents/schema.js';
import { sourceRecordSchema } from './contract.js';

export const queueQuery=z.object({
  regionId:z.string().min(1).max(40).optional(),runId:z.string().uuid().optional(),
  state:z.enum(['OPEN','RESOLVED','DISMISSED','ALL']).default('OPEN'),
  reasonCode:z.string().regex(/^[A-Z_]{2,80}$/).optional(),
  page:z.coerce.number().int().min(1).max(100_000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const base=z.object({expectedVersion:z.number().int().positive(),expectedCursorVersion:z.number().int().min(0),reason:reasonSchema});
const corrections=z.object({
  title:sourceRecordSchema.shape.fields.shape.title.optional(),
  statusCode:sourceRecordSchema.shape.fields.shape.statusCode.optional(),
  sourceUpdatedAt:sourceRecordSchema.shape.sourceUpdatedAt.optional(),
  institutionCode:sourceRecordSchema.shape.institutionCode.optional(),
}).strict().refine(x=>Object.keys(x).length>0,'Supply at least one reviewed field');
export const resolveSchema=z.discriminatedUnion('action',[
  base.extend({action:z.literal('RETRY')}).strict(),
  base.extend({action:z.literal('DISMISS')}).strict(),
  base.extend({action:z.literal('CORRECT_AND_RETRY'),corrections}).strict(),
]);
export type QueueQuery=z.infer<typeof queueQuery>;
export type ResolveInput=z.infer<typeof resolveSchema>;
