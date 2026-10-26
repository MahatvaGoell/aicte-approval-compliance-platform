import { describe, expect, it } from 'vitest';
import { rankExperts, type ExpertCandidate, type SuggestionContext } from '../src/modules/evc/suggestions.js';
const expert: ExpertCandidate = { userId: 'a', name: 'A', specialisms: ['ENGINEERING'], homeRegion: 'WEST', directoryComplete: true,
  eligible: true, activeAppointment: true, ownInstitution: null, affiliatedRegions: [], declaredConflict: false,
  available: true, overlapping: false, monthlyVisits: 0, maxVisits: 6 };
const ctx: SuggestionContext = { institutionId: 'college', regionId: 'WEST', specialism: 'ENGINEERING', mode: 'PHYSICAL',
  mandatoryConflicts: ['OWN_INSTITUTION','DECLARED'], overdueDays: 2 };
describe('M4 explainable suggestions', () => {
  it('ranks workload and travel explicitly with shared case urgency', () => {
    const rows = rankExperts([{ ...expert, userId: 'busy', monthlyVisits: 4 }, { ...expert, userId: 'free' }], ctx);
    expect(rows[0].userId).toBe('free'); expect(rows[0].factors).toEqual({ urgency: 4, workload: 40, travel: 20 });
  });
  it('blocks unknown directory, eligibility, availability, specialism and reservations', () => {
    const row = rankExperts([{ ...expert, directoryComplete: false, eligible: false, available: false, overlapping: true, specialisms: [], monthlyVisits: 6 }], ctx)[0];
    expect(row.selectable).toBe(false);
    expect(row.blockers).toEqual(expect.arrayContaining(['INFORMATION_UNAVAILABLE','NOT_ELIGIBLE','NOT_AVAILABLE','OVERLAPPING_RESERVATION','SPECIALISM_MISMATCH','MONTHLY_CAPACITY']));
  });
  it('distinguishes advisory affiliation from mandatory configured conflicts', () => {
    const e = { ...expert, ownInstitution: 'college', declaredConflict: true, affiliatedRegions: ['WEST'] };
    expect(rankExperts([e], ctx)[0].blockers).toEqual(['OWN_INSTITUTION','DECLARED']);
    expect(rankExperts([e], { ...ctx, mandatoryConflicts: ['REGION_AFFILIATION'] })[0].blockers).toEqual(['REGION_AFFILIATION']);
  });
  it('uses deterministic ties, online travel and bounded urgency without predicting approval', () => {
    const rows = rankExperts([{ ...expert, name: 'Z' }, { ...expert, name: 'B' }], { ...ctx, mode: 'ONLINE', overdueDays: 400 });
    expect(rows[0].name).toBe('B'); expect(rows[0].factors.urgency).toBe(60); expect(rows[0].travelBasis).toContain('online');
  });
});
