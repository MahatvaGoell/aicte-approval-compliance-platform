// Mount points for the finale features. Each renders nothing until the case API returns its field,
// so the page stays honest and the feature branch only has to fill these in.
type View = any;

/** Total days, with institution, with office, returned N times. Hidden until `v.accountability` exists. */
export function AccountabilityClockSlot(_props: { v: View }) {
  return null;
}

/** "Double claims" disclosure for the main column. Hidden until the detector's findings exist on the case. */
export function DoubleClaimsSlot(_props: { v: View }) {
  return null;
}

/** Approval letter card with its verify QR and a Print button. Hidden until a letter exists on the case. */
export function ApprovalLetterSlot(_props: { v: View }) {
  return null;
}
