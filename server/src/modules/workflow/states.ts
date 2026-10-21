import { ConflictError } from '../../db.js';

// Explicit valid transitions. Application lifecycle and stage task states are separate machines.

export const APPLICATION_STATES = [
  'DRAFT', 'SUBMITTED', 'AWAITING_CLASSIFICATION', 'IN_PROCESS', 'AWAITING_DECISION', 'DECISION_RECORDED',
  'CLOSED', 'WITHDRAWN',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

const APPLICATION_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['IN_PROCESS', 'AWAITING_DECISION', 'AWAITING_CLASSIFICATION', 'WITHDRAWN'],
  AWAITING_CLASSIFICATION: ['IN_PROCESS', 'AWAITING_DECISION'],
  IN_PROCESS: ['IN_PROCESS', 'AWAITING_DECISION'],
  AWAITING_DECISION: ['DECISION_RECORDED', 'IN_PROCESS'],
  DECISION_RECORDED: ['CLOSED', 'IN_PROCESS'],
  CLOSED: [],
  WITHDRAWN: [],
};

export const STAGE_STATES = ['QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_RESPONSE', 'COMPLETED', 'CANCELLED'] as const;
export type StageState = (typeof STAGE_STATES)[number];
export const LIVE_STAGE_STATES: StageState[] = ['QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_RESPONSE'];

const STAGE_TRANSITIONS: Record<StageState, StageState[]> = {
  QUEUED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'AWAITING_RESPONSE', 'CANCELLED'],
  IN_PROGRESS: ['IN_PROGRESS', 'ASSIGNED', 'COMPLETED', 'AWAITING_RESPONSE', 'CANCELLED'],
  AWAITING_RESPONSE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertApplicationTransition(from: string, to: ApplicationState) {
  if (!APPLICATION_TRANSITIONS[from as ApplicationState]?.includes(to)) {
    throw new ConflictError(`An application in state ${from} cannot move to ${to}`, { code: 'INVALID_TRANSITION', from, to });
  }
}

export function assertStageTransition(from: string, to: StageState) {
  if (!STAGE_TRANSITIONS[from as StageState]?.includes(to)) {
    throw new ConflictError(`A stage in state ${from} cannot move to ${to}`, { code: 'INVALID_TRANSITION', from, to });
  }
}

export const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  AWAITING_CLASSIFICATION: 'Awaiting classification',
  IN_PROCESS: 'In process',
  AWAITING_DECISION: 'Awaiting decision',
  DECISION_RECORDED: 'Decision recorded',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
  QUEUED: 'Queued (unassigned)',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  AWAITING_RESPONSE: 'Awaiting institution response',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
