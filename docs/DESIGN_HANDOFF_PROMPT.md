# Design handoff: "Registered Post" UI (continue on another Claude)

Paste the block below into the new Claude session, opened in the repository root.

```text
Main SIH 2026 project (PS SIH26262, ApprovalTrack, team Infera) ka kaam continue kar raha hoon. Repo: aicte-approval-compliance-platform. Branch: ui-redesign.

Mujhse Hinglish me short baat kar. Commits/docs/PR me koi AI ya Claude attribution mat daalna (no Co-Authored-By, no "Generated with"). Push sirf tab jab main bolun. Force push kabhi nahi.

## 1. Pehle ye padh (is order me)
1. AGENTS.md (product + code rules)
2. web/PRODUCT.md (product truth)
3. web/DESIGN.md + web/.impeccable/design.json (naya design system: tokens, components, named rules) ← sabse important
4. web/.impeccable/surfaces/src-app-tsx.md (direction contract). NOTE: web/.impeccable/surfaces/approval-workspace.md purane (Codex wale) design ka brief hai, use ignore kar.
5. docs/NATIONAL_ROUND_PLAN.md (aage ke features ka plan), docs/HANDOFF.md, docs/PROGRESS.md
6. Screenshots: docs/ui-postal/ (final design, light/dark, desktop/mobile)
Design kaam ke liye "impeccable" skill use kar (agar installed hai): `impeccable context` chala ke shuru kar.

## 2. Design decision (final, user ne approve kiya)
Theme: "Registered Post with AD". Har application ek registered parcel/consignment ki tarah office se office jaati hai. Har poori hui stage pe dated postmark lagta hai, live stage "in transit" dikhti hai with due date, aur kuch bhi tab tak "done" nahi jab tak acknowledge (AD sign-off) na ho. Generic card-grid admin dashboard REFUSE kiya gaya hai.

User ke pinned rules (todna mat):
- Light: bright off-white/beige paper (#f3eee3 bg, #fbf8f1 surface, #fffdf8 raised), ink #1b1713. Muddy brown/yellow cast nahi.
- Dark: ~99% black with faint brown: #030202 bg, #080605 surface, #0c0907 raised; text beige #f1e8da. Bade panels bhi almost-black rahein.
- Koi green, blue, purple, olive, gold, brass accent NAHI. Accent = ink (light me black, dark me beige). Sepia stamp ink (#5b4431 / dark #d2bb9c) sirf stamps/marks ke liye.
- Natural red (#923a2c on #f3e0d8; dark #e89c8e on #2a1411) SIRF late/overdue/returned/error ke liye, bina border, bina coloured side stripe.
- Status hamesha text + colour (sirf colour nahi).
- Simplicity sabse upar: har screen pe ek dominant region (next action), secondary cheezein named disclosures me.
- Fonts sirf local bundled Inter + JetBrains Mono (offline). Koi CDN/Google Fonts/remote asset nahi.
- Motion: stamp land 320ms, route hop draw 320ms, page settle 360ms; koi infinite loop nahi (sirf loading shimmer); prefers-reduced-motion pe sab off.

Signature components (web/src/ui.tsx + styles.css):
- Postmark: gol dated stamp (double ring, arc text, date bar, SVG ink texture), "land" animation. Poori stage aur verified document pe.
- AD mark: completed hop ke neeche "AD · Signed off by <owner>".
- Consignment slip (case header): bada mono application number + Barcode + meta strip + perforated tear line + tracking route (hops).
- Delivery note (case): next action = h2, NamePlate (responsible person), right side Urgency (bada number + 5-band ramp: 15+d / 4–14 / 2–3 / Today / Late) + role-aware primary button (Record the decision / Open your checklist / Classify / File an appeal).
- Urgency ramp: ek hi scale har jagah jahan clock ho. Late = red + hatch pattern.
- Paper sheets (Documents register): letterhead, ruled lines, folded corner, multiple versions = stacked sheets; DocStamp = verified pe postmark, pending pe dashed rubber stamp, expired/rejected pe red rubber stamp.
- Sorting board (Dashboard): upar time-pressure lead row (Overdue, Due within 7 days); sab zero ho to ek "Nothing is overdue..." line; neeche pigeonhole rack, count ke hisaab se slip pile.
- Shell: left rail, active nav = "slip pulled out" (paper shadow), top bar me location crumb (sectionFor label), demo banner "DEMO" rubber tag. Eyebrow/kicker labels BANNED (heading khud bolta hai).

Screens done: Login, Home/My work, Applications, New/Edit application (paper booking form + "draft at a glance" checklist), Case workspace, Dashboard, Documents + Obligations, Expert visits. Typecheck, build, 226 tests pass. Server code chhua nahi.

## 3. Pehla kaam: state check
- `git status` dekh. Agar redesign uncommitted hai to mujhe bata, commit mere kehne pe hi.
- Services chala (docs/HANDOFF.md ke steps), DB reset mat karna agar data hai. Login page pe role card click se login hota hai.
- Screens khol ke dekh light + dark me, phir mujhe 5 line me bata kya dikha.

## 4. Bacha hua DESIGN kaam (isi world me, naya look mat banana)
A. Out-of-scope pages ko same world me laana: Reports, Notifications, Audit log, Policy (list/detail/diff), Operations, Mock integration. Abhi sirf tokens inherit karte hain. Ideas: Audit log = ledger/register with hash chain as perforated receipt stubs; Notifications = delivery slips (unread = raised paper, escalation = red borderless); Policy diff = amendment slip with struck/added lines; Reports = register table + CSV.
B. Reviewer ke partial items:
   - Dashboard abhi bhi thoda tile-grid lagta hai → rack ko aur "sorting case" jaisa banao (shared walls, pile scale), lead row ko dominant rakho.
   - Mobile/800px pe upar ka chrome (brand row + crumb + demo banner) ~200px hai → aur compact karo.
   - Perforation (slip aur route ke beech) weak hai → punched holes/edge notches clear karo.
   - Case ke andar wale documents (CaseM5 DocumentsCard) me letterhead + ruled lines nahi hain, sirf register pe hain → same paper sheet grammar lao.
   - Postmark arc text me stage name hai; office/role naam behtar (agar data me ho).
   - Paper grain (body::before noise, opacity 0.06–0.07) almost invisible hai → thoda dikhe par text contrast na gire.
C. Cleanup: styles.css me `.field-cap` unused hai; public/fonts/SpaceGrotesk-500.woff2 unused; "+" text glyphs (filter-more, details.pw) ko drawn SVG icon se replace karo; approval-workspace.md surface brief purana hai (mujhse puchh ke hatao).
Har change ke baad: npm run typecheck, npm test, npm run build. Light+dark, 1440 + 390 width pe screenshot le ke khud check kar.

## 5. Aage ke FEATURES (docs/NATIONAL_ROUND_PLAN.md) + unka design
Order: C3 → C4 → C5 → D (M7) → E.
- C3: scanned PDFs ke liye offline OCR (tesseract.js), C2 ka text pipeline reuse.
- C4 (judges ke liye WOW): M5 document review screen pe "suggested expiry date" dikhana. Design: document paper sheet pe suggested value sepia highlighter (stamp-soft) se marked excerpt + page number; ek dashed rubber stamp "Suggested · not verified"; officer "Confirm" kare to postmark land ho ("Valid through <date>"). Abstain/unsure pe honest "No date found" state. System kabhi khud verify nahi karta.
- C5: `npm run evaluate:extraction` accuracy table (measured, koi invented number nahi). UI me dikhana ho to register table style.
- D1–D5 (M7): policy impact preview (amendment slip: "is rule change se ye N cases affect honge"), gap panel (delivery note ke andar "Undelivered items": kya missing, kisse), priority queue (My work tray urgency ramp se sorted, late upar red hatch).
- E1–E3: reset command + DEMO_SCRIPT.md, chaos test (worker 20–30 baar kill, 0 duplicate/0 missing), rehearsal.

## 6. Rules jo kabhi nahi todne
System kabhi approve/reject nahi karta (sirf competent authority). Har rule ka provenance label (APH_CLAUSE / ADMIN_INSTRUCTION / DEMO_ASSUMPTION). Sab data synthetic. Koi real email/external service nahi. Live AICTE connection ka claim nahi. Koi made-up number/percentage nahi; pehle measure karo. server/, migrations, API contracts, permissions design kaam me mat chhuo.

Har step ke baad mujhe Hinglish me batana kya kiya aur kya click karke check karun.
```
