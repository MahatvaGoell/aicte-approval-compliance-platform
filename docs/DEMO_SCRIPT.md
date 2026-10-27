# Finale demo (synthetic, local only)

Start PostgreSQL, run `npm run db:reset`, start API/web/worker, then `npm run demo:scenarios`. Resetting replaces the disposable demo database. Use a fresh browser session for each role.

## A — No-Reset Accountability Clock

1. Sign in as **inst.west@demo.aicte.test**. Applications → **APP-2027-28-01002** (returned intake case). Below the consignment slip, read the recorded custody totals, return count and first/current due dates. No elapsed days are preclaimed; they depend on the stored records and demo clock.
2. Findings → response field → enter the supplied lease clarification → **Send response**. The case opens attempt 2 and custody returns to the office. Note that the original stage due date stays on screen.
3. Sign in as **scrutiny.west2@demo.aicte.test** (the prepared case owner; confirm its name in Assignment). Open the same case → Findings → **Raise a finding**. Choose **New objection**: the justification field is required. Enter at least 20 characters, save, then show the institution-visible justification. Alternatively link the earlier objection. The rule is **DEMO_ASSUMPTION**.
4. Officer Reports → **Returns and holding** → **Download CSV**. The same scoped records and custody values appear in both. Optional administrator clock advances exercise the real calendar accounting; do not quote example durations as measurements.

Tagline: File peeche ja sakti hai, accountability nahi.
