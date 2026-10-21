import { z } from 'zod';

// Demonstration application form (schema version demo-form-v1). The real AICTE form is far larger;
// this keeps the fields that routing, readiness and consistency checks need.

export const FORM_SCHEMA_VERSION = 'demo-form-v1';

export const programmeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  level: z.enum(['DIPLOMA', 'UG', 'PG']),
  intake: z.number().int().min(1).max(600),
});

export const draftDataSchema = z
  .object({
    campusAddress: z.string().trim().max(400).optional(),
    landAreaAcres: z.number().min(0).max(10000).optional(),
    programmes: z.array(programmeSchema).max(40).optional(),
    declarationAccepted: z.boolean().optional(),
    remarks: z.string().trim().max(2000).optional(),
  })
  .strict();

export const proposalDetailsSchema = z
  .object({
    intakeIncreasePercent: z.number().min(0).max(1000).optional(),
    proposedSiteAddress: z.string().trim().max(400).optional(),
  })
  .strict();

export const createApplicationSchema = z.object({
  cycleCode: z.string().min(1),
  categoryCode: z.string().regex(/^[A-Z0-9_]+$/),
  details: proposalDetailsSchema.default({}),
  draftData: draftDataSchema.default({}),
});

export const updateDraftSchema = z.object({
  expectedVersion: z.number().int(),
  categoryCode: z.string().regex(/^[A-Z0-9_]+$/).optional(),
  details: proposalDetailsSchema.optional(),
  draftData: draftDataSchema,
});

export interface FieldProblem {
  field: string;
  message: string;
}

/** Fields required before submission. Returned as a list so the UI can show every gap at once. */
export function submissionProblems(draft: z.infer<typeof draftDataSchema>, categoryCode: string, details: Record<string, unknown>): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (!draft.campusAddress) problems.push({ field: 'campusAddress', message: 'Campus address is required' });
  if (!draft.landAreaAcres || draft.landAreaAcres <= 0) problems.push({ field: 'landAreaAcres', message: 'Land area must be greater than zero' });
  if (!draft.programmes || draft.programmes.length === 0) problems.push({ field: 'programmes', message: 'Add at least one programme' });
  if (draft.declarationAccepted !== true) problems.push({ field: 'declarationAccepted', message: 'The declaration must be accepted' });
  if (categoryCode === 'INCREASE_IN_INTAKE' && typeof details.intakeIncreasePercent !== 'number') {
    problems.push({ field: 'details.intakeIncreasePercent', message: 'Intake increase percentage is required for this category' });
  }
  if (categoryCode === 'CHANGE_OF_SITE' && !details.proposedSiteAddress) {
    problems.push({ field: 'details.proposedSiteAddress', message: 'Proposed site address is required for this category' });
  }
  return problems;
}
