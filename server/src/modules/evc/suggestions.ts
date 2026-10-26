export interface ExpertCandidate {
  userId: string; name: string; specialisms: string[]; homeRegion: string | null;
  directoryComplete: boolean; eligible: boolean; activeAppointment: boolean;
  ownInstitution: string | null; affiliatedRegions: string[]; declaredConflict: boolean;
  available: boolean; overlapping: boolean; monthlyVisits: number; maxVisits: number;
}
export interface SuggestionContext {
  institutionId: string; regionId: string; specialism: string; mode: string;
  mandatoryConflicts: string[]; overdueDays: number;
}
/** Deterministic suggestions, not automatic appointment or a regulatory risk score. */
export function rankExperts(experts: ExpertCandidate[], c: SuggestionContext) {
  return experts.map((e) => {
    const conflicts = [
      ...(e.ownInstitution === c.institutionId ? ['OWN_INSTITUTION'] : []),
      ...(e.declaredConflict ? ['DECLARED'] : []),
      ...(e.affiliatedRegions.includes(c.regionId) ? ['REGION_AFFILIATION'] : []),
    ];
    const blockers = [
      ...(!e.directoryComplete ? ['INFORMATION_UNAVAILABLE'] : []),
      ...(!e.eligible || !e.activeAppointment ? ['NOT_ELIGIBLE'] : []),
      ...(!e.specialisms.includes(c.specialism) ? ['SPECIALISM_MISMATCH'] : []),
      ...(!e.available ? ['NOT_AVAILABLE'] : []), ...(e.overlapping ? ['OVERLAPPING_RESERVATION'] : []),
      ...(e.monthlyVisits >= e.maxVisits ? ['MONTHLY_CAPACITY'] : []),
      ...conflicts.filter((x) => c.mandatoryConflicts.includes(x)),
    ];
    const factors = {
      urgency: Math.min(30, Math.max(0, c.overdueDays)) * 2,
      workload: Math.max(0, 40 - e.monthlyVisits * 5),
      travel: c.mode === 'ONLINE' ? 20 : e.homeRegion === c.regionId ? 20 : e.homeRegion ? 5 : 0,
    };
    return { ...e, conflicts, blockers, selectable: blockers.length === 0, factors,
      score: factors.urgency + factors.workload + factors.travel,
      travelBasis: c.mode === 'ONLINE' ? 'No travel for online mode' : e.homeRegion === c.regionId ? 'Same home region (proxy only)' : 'Different or unavailable home region; no distance claim' };
  }).sort((a, b) => Number(b.selectable) - Number(a.selectable) || b.score - a.score || a.name.localeCompare(b.name));
}
