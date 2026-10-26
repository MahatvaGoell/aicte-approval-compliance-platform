import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/** Filters shared by dashboards, report rows and (later) CSV, so every view of a number uses the same definition. */
export const FILTER_KEYS = ['regionId', 'institutionId', 'categoryCode', 'stageKey', 'submittedFrom', 'submittedTo'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const filterShape = {
  regionId: z.string().max(40).optional(),
  institutionId: z.string().uuid().optional(),
  categoryCode: z.string().max(60).optional(),
  /** `NONE` selects cases that have no live stage (for example awaiting classification). */
  stageKey: z.string().max(60).optional(),
  submittedFrom: isoDate.optional(),
  submittedTo: isoDate.optional(),
};

const ordered = (f: { submittedFrom?: string; submittedTo?: string }) => !f.submittedFrom || !f.submittedTo || f.submittedFrom <= f.submittedTo;
const orderedMessage = { message: 'submittedFrom must not be after submittedTo', path: ['submittedFrom'] };

export const dashboardQuery = z.object(filterShape).refine(ordered, orderedMessage);

export const reportQuery = z
  .object({
    ...filterShape,
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(ordered, orderedMessage);

export type ReportFilters = z.infer<typeof dashboardQuery>;
export type ReportQuery = z.infer<typeof reportQuery>;
