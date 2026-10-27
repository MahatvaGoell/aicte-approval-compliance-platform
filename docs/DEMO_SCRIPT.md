# Finale demo (synthetic, local only)

Start PostgreSQL, run `npm run db:reset`, start API/web/worker, then `npm run demo:scenarios`. Resetting replaces the disposable demo database. Use a fresh browser session for each role.

## A — No-Reset Accountability Clock

1. Sign in as **inst.west@demo.aicte.test**. Applications → **APP-2027-28-01002** (returned intake case). Below the consignment slip, read the recorded custody totals, return count and first/current due dates. No elapsed days are preclaimed; they depend on the stored records and demo clock.
2. Findings → response field → enter the supplied lease clarification → **Send response**. The case opens attempt 2 and custody returns to the office. Note that the original stage due date stays on screen.
3. Sign in as **scrutiny.west2@demo.aicte.test** (the prepared case owner; confirm its name in Assignment). Open the same case → Findings → **Raise a finding**. Choose **New objection**: the justification field is required. Enter at least 20 characters, save, then show the institution-visible justification. Alternatively link the earlier objection. The rule is **DEMO_ASSUMPTION**.
4. Officer Reports → **Returns and holding** → **Download CSV**. The same scoped records and custody values appear in both. Optional administrator clock advances exercise the real calendar accounting; do not quote example durations as measurements.

Tagline: File peeche ja sakti hai, accountability nahi.

## B — Double-Claim Detector

After the standard nine cases, run `npm run demo:finale` once. The script writes actual identifiers to `var/finale-cases.json`; on a fresh reset the cases below are 01010–01015.

1. **ro.west@demo.aicte.test** → Applications → **APP-2027-28-01010** → **Double claims**. FAC-DEMO-0001 overlaps a North case. The regional officer sees “Also claimed by another institution outside your scope”, with no other case number.
2. Record an **Explained** or **Confirmed by officer** view with at least 20 characters. Optionally select **Share this note with this case's institution**, then **Record claim review**. These are officer views; raising a finding remains a separate action.
3. **bureau@demo.aicte.test** → the same case → Double claims: the in-scope counterpart **APP-2027-28-01011** is linked. **APP-2027-28-01012** has the same lab claimed by two programmes. **01013/01014** share a building. **01015** has the same faculty name but FAC-DEMO-0999 and no flag.
4. **inst.west@demo.aicte.test** → 01010 → Double claims: own resource, flag and explicitly shared officer note only. Reports → **Cases with double claims** → **Download CSV** retains the same scope.

Tagline: Ek teacher, ek lab, ek hi claim. The DEMO_ASSUMPTION exclusivity rule flags only; it makes no regulatory decision.
