import { z } from 'zod';
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
  const n = Date.parse(d + 'T00:00:00Z'); return Number.isFinite(n) && new Date(n).toISOString().slice(0,10) === d;
}, 'Enter a real calendar date');
export const metadataSchema = z.object({ institutionName: z.string().trim().max(300).optional(), campusAddress: z.string().trim().max(1000).optional(),
  landAreaAcres: z.number().positive().max(100000).optional(), issuedOn: dateOnly.optional(), validThrough: dateOnly.optional(),
  page: z.number().int().positive().max(200).optional(), excerpt: z.string().trim().max(2000).optional(),
}).strict().refine((m) => !m.issuedOn || !m.validThrough || m.issuedOn <= m.validThrough, 'Valid-through must not precede issue date');
export const uploadSchema = z.object({ expectedVersion: z.coerce.number().int().positive(), documentId: z.string().uuid().optional(),
  documentExpectedVersion: z.coerce.number().int().positive().optional(), title: z.string().trim().min(3).max(200),
  documentType: z.string().regex(/^[A-Z0-9_]{2,60}$/), visibility: z.enum(['INTERNAL','INSTITUTION']).default('INSTITUTION'),
  declaredMetadata: metadataSchema.default({}),
}).strict();
export const reasonSchema = z.string().trim().min(10).max(2000);
