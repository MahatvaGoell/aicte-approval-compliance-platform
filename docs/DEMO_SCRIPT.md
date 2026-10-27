# Finale demo (synthetic, local only)

Start PostgreSQL, run `npm run keys:demo` and `npm run db:reset`, start API/web and the separate `npm run dev:witness`, then run `npm run demo:scenarios` followed by `npm run demo:finale`. Start `npm run dev:worker` after the cases are ready. Resetting replaces the disposable demo database. Use a fresh browser session for each role.

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

## C — Verify QR and witnessed audit

### Signed letter

1. **authority@demo.aicte.test** → Applications → **APP-2027-28-01004** → record an **Approved** decision with the authority's reason. **Approval letter** appears only after this authorised action. Rejected/deferred decisions receive no letter.
2. **inst.north@demo.aicte.test** → **APP-2027-28-01006** → **Approval letter** → **Print letter**. The new authenticated tab prints only the letter on one A4 page. Scan its QR or select **Open public verification**. The verification page works without a session and separates **Signed at issue** from **Current record (checked now)**. Intake/conditions come from stored records; there is no invented validity end.
3. For a tamper beat, copy the token from that link. In a local development console decode its first base64url component, increase the stored `intake` value, re-encode the JSON and leave the signature component unchanged. Open `/verify/<changed token>`. The page says **This letter was not issued by this system**. Q02 automates this exact alteration; no modified field is accepted or displayed as signed data.
4. **authority@demo.aicte.test** → **01006** → Approval letter → enter a revocation reason → **Revoke demo letter**. Refresh the same public verification URL: signature/issue fields remain valid and unchanged, while the current record says **Letter revoked**. Approval/compliance/lifecycle are not rewritten by revocation.

Tagline: Fake approval letter ab nahi chalega. Qualification on both screens: **Verifies letters issued by this demo system only. DEMO KEY.**

### Witness demo moment

1. Keep the witness on **127.0.0.1:4100** and the worker running. **auditor@demo.aicte.test** → **Audit log** → **Verify integrity**. Wait until at least one witnessed checkpoint exists. Both **Local chain** and **Witness** report their own matching result.
2. Stop the worker for a stable rehearsal snapshot; leave API/web/witness running. In another terminal run **`npm run demo:rewrite-chain`**. It refuses outside demo mode or without a PostgreSQL superuser and an affected stored checkpoint. It edits the oldest audit event and recomputes the later hashes directly, deliberately bypassing application triggers.
3. Same auditor page → **Verify integrity** again: **Local chain intact**, **Witness mismatch**. The first affected checkpoint ID is returned only to all-scope auditors. In the verified rehearsal this was event 1 and checkpoint 265; future runs must use their actual displayed IDs.
4. Stop the witness and verify once more to demonstrate **Witness unavailable**, never an intact/pass result. Restarting it reuses its own key/store.

Tagline: Admin bhi history chupke se nahi badal sakta. Qualification: this witness is a second process on the **same machine**; production needs a separate organisation and protected keys/store. Events after the last checkpoint remain unwitnessed.

For a clean reset, stop worker and witness, archive the existing `var/witness` directory with its key and JSONL together, then reset the synthetic database and start a fresh witness. Do not silently delete or replace a witness ledger while retaining the old main database. This implementation's rehearsal restored its saved original audit snapshot; the witness store was not changed.
