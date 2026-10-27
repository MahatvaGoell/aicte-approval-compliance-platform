// Mount points for the finale features on the case page. Each renders nothing until the case API returns its field.
import { AccountabilityStrip } from './CaseAccountability';
import { DoubleClaimsPanel } from './CaseDoubleClaims';
import { ApprovalLettersPanel } from './CaseLetters';

type View = any;

/** Total days, with institution, with office, returned N times. Sits inside the At a glance panel. */
export function AccountabilityClockSlot({ v }: { v: View }) {
  return <AccountabilityStrip v={v} />;
}

/** "Double claims" disclosure for the main column: exact resource identities and overlapping periods, flags only. */
export function DoubleClaimsSlot({ v }: { v: View }) {
  return <DoubleClaimsPanel v={v} />;
}

/** Approval letter with its verify QR and a Print button. Renders nothing until a letter has been issued. */
export function ApprovalLetterSlot({ v }: { v: View }) {
  return <ApprovalLettersPanel v={v} />;
}
