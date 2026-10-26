# National round plan (SIH 2026 · SIH26262 · Team Infera)

Last updated: 26 Oct 2026. **Is file ko sabse pehle padho.** Ye batati hai ki internal round ke baad national round ke liye exactly kya banana hai, kis order me, kaise, aur kaise check karna hai.

**Current handoff:** pehle WORK_LOG.md padho. M1–M6 aur C1 local checkout me complete hain (**209 tests**); C1 = 24 labelled PDFs / 32 pages, generator/QA (EXTRACTION_DATASET.md). Next = **C2 text extraction only** (NEXT_PROMPT.md). Har step par local commit aur report ke baad rukna. User ka standing order: **push nahi**; neeche ke purane push instructions abhi apply nahi. C2–C5 ke baad M7, phir demo prep; M8 AI/load abhi scope me nahi.

Team Infera: Arihant Jain, Yuvika Mittal, Alwaz Alam, Reeshu Singh Rajput, Mahatva Goel.

---

## 0. Ek line me plan

**Jo PPT me promise kiya (8 modules) wo poora banao → uske upar ek "wow" feature (PDF se expiry date nikaal ke highlight karna) → demo ki practice (chaos test + QR tamper check sirf chhote moments).**

Kuch bhi "headline" mat banao jo problem se hat ke ho. Story hamesha same: *"File kahan atki hai, kiske paas hai, kab tak — sab ek jagah, aur deadline system khud chase karta hai. Faisla insaan karta hai."*

---

## 1. Ab tak kya ho chuka hai

| Cheez | Status |
|---|---|
| M1 auth, scopes, ek poora workflow | Done |
| M2 returns, re-scrutiny, 5 routes, classification, appeals, policy versioning | Done |
| M3 deadlines, reminders 30/7/1, escalation, notifications, email outbox, worker, demo clock | Done (99 tests pass) |
| M4 EVC queue, conflicts, reservations, visit reports | Done (teammate, 26 Oct) |
| M5 private documents, obligations, verification, lease renewal | Done (teammate, 26 Oct) — **139 tests pass**. Metadata abhi manual hai, OCR/auto-extraction nahi |
| M6 dashboards/reports/CSV, audit, mock integration/reconciliation | **Done locally** — 204 tests; B7 closed; M6_ACCEPTANCE.md me evidence/limits |
| PDF expiry C1 | **Done locally** — 24 PDFs (16 text / 8 scans), independent labels, reproducible generator, 209 tests |
| PDF expiry C2–C5 / M7 / demo prep | **Baaki** — NEXT_PROMPT.md me C2-only prompt hai; extraction accuracy abhi measure nahi hui |
| Idea PPT (internal round) | Done → `docs/sih/SIH26262-Idea-Presentation.pptx` aur `.pdf` |
| Internal round | **Select ho gaye** |
| 8 feature ideas ka "court trial" (jury of Claudes) | Done → `docs/sih/court-verdicts/` |

PPT slide 4 me "8 modules working as one system" likha hai. Ab M1–M6 bane hain; PDF extraction, M7 aur demo prep baaki. **National judges code + demo dekhenge; sirf implemented aur measured features ka claim karo.**

---

## 2. Court trial ka result (kyon ye plan)

8 ideas ko `/court --quick` se test kiya (har idea pe prosecutor, defense, 6 jurors, judge). **Sab "headline feature" ke roop me GUILTY aaye.** Poore verdicts `docs/sih/court-verdicts/*.md` me hain.

| Idea | Verdict | Faisla |
|---|---|---|
| 1. PDF se expiry date (AI/rules) + highlight | GUILTY 5–1 | **Banao**, document module ke andar. Offline method + measured accuracy chahiye |
| 7. Natural-language search | GUILTY 4–2 | Sirf spare time me, local parser ke saath |
| 8. Chaos demo (worker kill/restart) | GUILTY 4–2 | **Chhota demo moment**, pehle 20–30 baar test |
| 2. QR "verify letter" | GUILTY 6–0 | Sirf tamper-detection demo moment (agar time ho) |
| 6. EVC scheduling (as headline) | GUILTY 6–0 | Module banana hi hai (M4), par climax = "conflicted expert blocked", double-booking nahi |
| 3. Hindi alerts | GUILTY 6–0 | Abhi mat banao |
| 4. 10,000-case simulation | GUILTY 6–0 | Abhi mat banao |
| 5. Public India map | GUILTY 6–0 | Abhi mat banao (dashboard me login ke andar drill-down ho sakta hai) |

Jury ki common baatein: (a) unbuilt modules sabse bada risk; (b) koi bhi claim bina saboot ke mat karo (accuracy number, test result); (c) har feature ko core story se jodo.

---

## 3. Kaam ka order (priority)

Agar time kam pade toh **neeche se kaato, upar se nahi.** BUILD_PLAN §21 ka rule: *document tracking, EVC alerts aur human verification kabhi cut nahi hote.*

| # | Kaam | Kyun | Estimated effort* |
|---|---|---|---|
| ✅ | ~~M4 EVC~~ | **Done** (teammate) | — |
| ✅ | ~~M5 Documents + obligations~~ | **Done** (teammate) | — |
| ✅ | ~~M6 Dashboards + audit viewer + reports + mock integration~~ | **Done locally**; M6_ACCEPTANCE.md | — |
| 2 | **PDF expiry-date extraction + highlight** (M5 ke upload/review screen pe) | Wow moment, jury ka sabse kam-negative idea | 2 din |
| 5 | **M7 Policy impact preview + action/gap panel** | PPT promise, second differentiator | 1–2 din |
| 6 | **Demo prep**: chaos test, demo script, reset command, 3 full rehearsals | Live demo fail nahi hona chahiye | 1–2 din |
| 7 | (Optional) QR tamper check, NL search, load test | Sirf agar sab upar ka done ho | — |

\*Estimate ek focused developer + Claude ke saath. 5 log parallel kaam karein toh kam (section 9 dekho).

**Time pata karo pehle:** finale ki date likh lo yahan → `Finale date: ______` · `Din bache: ____`. Agar 10 din se kam hain toh #5 ko sirf policy preview tak rakho aur #7 skip.

---

## 4. Har kaam step-by-step

Har milestone ka pattern same hai (AGENTS.md ke rules follow karo):
**migration (if needed) → service/command → API/web (if in that step) → tests → typecheck/test/build/diff check → PROGRESS + WORK_LOG update → one local commit → report and stop.** Push remains paused. Current migrations are 001–007; next schema change must use 008 or later.

### 4.1 M4 — EVC scheduling ✅ DONE (teammate)
Ban chuka hai (PROGRESS.md dekho). Sirf **demo climax check** karo: point 9 neeche. Reference ke liye purane steps:
1. Migration `004_evc.sql`: `expert_profiles`, `expert_availability`, `declared_conflicts`, `evc_visits`, `expert_reservations` (**btree_gist exclusion constraint**: ek expert ki overlapping active reservation DB hi reject kare), `visit_events`, `visit_findings`. Synthetic seed.
2. Readiness queue (`ready_at` record karo), region-scoped API.
3. Conflict checks: own institution, declared conflict, same-region affiliation. Data missing ho toh **"information unavailable"**, kabhi "no conflict" nahi.
4. Suggestions: pure function, factors dikhao (urgency, workload, travel).
5. Commands: `PROPOSE_VISIT`, `CONFIRM_VISIT`, `RESCHEDULE_VISIT`, `CANCEL_VISIT`, `RECORD_VISIT_HELD`, `SUBMIT_VISIT_REPORT`, `ACCEPT_VISIT_REPORT`, `RETURN_VISIT_REPORT`. `evaluateCompletion` ka `to_regclass` fallback hatao.
6. Clocks: EVC scheduling due + visit report due (existing deadline engine reuse).
7. Web: `/evc` queue page, suggestion panel, calendar, case page pe visit detail, expert directory.
8. Tests: E01 (concurrent overlap rejected), E02 (reschedule → old alerts stale), E03 (report bina stage complete nahi).
9. **Demo climax (jury ki condition):** ek expert jo apni hi college ka hai, suggestion me **blocked** dikhe, reason ke saath aur rule ka label (`DEMO_ASSUMPTION`) — double-booking ko climax mat banao.

### 4.2 M5 — Documents, obligations, verification ✅ DONE (teammate)
Ban chuka hai (PROGRESS.md "M5 — what was built"). Demo me evidence trail panel aur lease renewal case check kar lo. Reference ke liye purane steps:
BUILD_PLAN §11 aur §12 + `docs/FOUNDATIONS.md` (upload checks aur storage **already bane hue hain, reuse karo**).
1. Migration `005_documents_obligations.sql`: `documents`, `document_versions` (storage key, SHA-256, uploader, receipt time, predecessor), `obligations` (decision/condition se link, due rule, verifier, state `OPEN → EVIDENCE_SUBMITTED → UNDER_VERIFICATION → FULFILLED / CLOSED_WITH_AUTHORISED_REASON`), `submissions` (receipt), `verifications` (accept/reject + reason), `extracted_fields` (field, value, page, excerpt, method, confirmed_by).
2. Upload: quarantine → file signature/size/page check → private storage. Download har baar access re-check.
3. Decision "approved with conditions" → condition se obligation bane (pehle manual entry).
4. Obligation ki deadline existing engine se (naya clock type). Reminders + escalation already kaam karenge.
5. Institution evidence upload kare → screen pe **"Submitted, awaiting verification"**; on-time hai ya nahi aur current document expired hai ya nahi — **teeno alag dikhane hain.**
6. Officer verify/reject kare. Reject = obligation wapas OPEN with reason. Purana version kabhi overwrite nahi.
7. **Evidence trail panel** case page pe: decision → condition → obligation → deadline → reminders → submission → exact document version → confirmed fields → verification → closure. Har link clickable.
8. Lease renewal demo case seed karo (expiring + expired + renewal awaiting verification + rejected renewal).
9. Tests: O01–O03, S03 (BUILD_PLAN §20).

### 4.3 PDF se expiry date nikaalna (wow feature) — offline, free
**C1 complete:** corpus/labels/generator ready; EXTRACTION_DATASET.md me coverage, coordinates aur QA. Neeche ka extractor/OCR/review/evaluation kaam abhi pending hai, staged C2–C5 me karna hai.
M5 me metadata review already hai (uploader suggestion + reviewer-confirmed valid-through, optional page/excerpt). Ye feature **usi suggestion ko automatic bharega**: upload ke baad extractor chale, suggested `valid-through` + page + excerpt bhare, reviewer wahi existing screen pe confirm kare. Naya review flow mat banao.
Jury ki condition: *offline method naam se batao, scan PDFs bhi, aur accuracy number napo.*
1. **Text PDF:** `pdfjs-dist` (ya `pdf-parse`) se har page ka text + position nikaalo.
2. **Scan PDF:** text layer khaali ho toh `tesseract.js` (free, offline OCR) se page image → text + word boxes. Isolated worker me chalao.
3. **Date dhoondo:** regex/rules (`dd/mm/yyyy`, `dd-mm-yyyy`, `12 March 2027`, `12.03.2027`) + aas-paas ke words se role decide karo: "valid till", "expiry", "expires on", "valid up to" → expiry; "dated", "executed on", "issued on" → issue date. Saare candidate dates dikhao, role ke saath.
4. **Output:** `{field, value, page, excerpt, bbox, method: 'text'|'ocr', ambiguous}`. Excerpt source text me hona hi chahiye. Kuch na mile toh **abstain** karo, guess mat karo.
5. **UI:** PDF viewer me us jagah **yellow highlight**, side me "Suggested expiry: 31 Mar 2027 (page 2, 'valid till 31/03/2027')" + **Confirm / Edit** button. Confirm hone ke baad hi deadline bane. Re-extraction kabhi live deadline silently change na kare.
6. **Accuracy napo:** 20–30 synthetic PDFs banao (lease deed, fire NOC; clean text, scan, do dates wala, date missing wala). Script `npm run evaluate:extraction` → table: kitne sahi, kitne galat, kitne abstain. **Yahi number judges ko dikhana hai** ("27 me se 24 sahi, 2 abstain, 1 galat — aur galat wala officer ne confirm screen pe pakda").
7. LLM optional hai; core rule-based + OCR se hi chalna chahiye (PPT me "runs offline, no paid services" likha hai).

### 4.4 M6 — Dashboards, reports, audit viewer ✅ DONE LOCALLY
Acceptance and limitations: M6_ACCEPTANCE.md. B2–B7 are complete, 204 tests pass. Expiring-document drill-down, historical trends and escalation totals remain explicitly unavailable; no live portal connector exists. The following list is retained as the original scope reference.
1. Role dashboards: region/stage-wise pending, overdue, due-this-week. **Har number pe click → wahi filtered list** (same scope rules).
2. CSV export.
3. Audit viewer page: filter by case/actor/date + **"Verify integrity"** button (existing `POST /audit/verify`).
4. Mock integration adapter: fixture "portal export" import, unknown codes → reconciliation queue. Live AICTE connection ka claim **nahi**.
5. Test R01.

### 4.5 M7 — Policy impact preview + action/gap panel
1. Draft policy me reminder 7 → 14 din karo → preview: kaunse cases ke kaunse reminders badlenge (deterministic recalculation, AI nahi). Running cases apne version pe rahenge.
2. Action panel already hai; gap panel add karo: case me kya missing hai (document, finding response, report).
3. Attention priority queue: rule-based (overdue days, due date, criticality) — factors dikhao, "AI prediction" mat bolo.

### 4.6 Demo prep (sabse zaroori last step)
1. **`docs/DEMO_SCRIPT.md`** likho (BUILD_PLAN §19 ka 7-minute table follow karo). Har step pe kaun sa role, kaunsa case, kya click.
2. **Reset command:** `npm run db:reset && npm run demo:scenarios` se exact demo state aaye. Prepared cases har stage pe (fallback).
3. **Chaos test (stage pe dikhane se pehle):**
   - Script banao jo 20–30 baar worker ko random time pe `kill -9` kare (sending aur recording ke beech bhi), restart kare.
   - Har run ke baad check: `deliveries` me har reminder exactly ek baar, koi missing nahi, `POST /audit/verify` pass.
   - Ek bhi fail → fix karo ya demo se moment hata do.
   - Stage pe chhota counter dikhao: "reminders due / sent / duplicates: 0".
4. **QR tamper check (optional):** approval letter PDF generate karo jisme QR (hash) ho → `/verify/:id` page "genuine / not genuine + hash". Demo: letter edit karo → scan fail. "Fake letters" wala claim tabhi karna jab source mile.
5. Teen full rehearsals reset se. Ek screen recording backup rakho (offline).
6. Laptop: charger, sleep off, sab offline chale.

---

## 5. Setup (naye laptop pe)

```bash
git clone https://github.com/MahatvaGoell/aicte-approval-compliance-platform.git
cd aicte-approval-compliance-platform
npm install
cp .env.example .env
npm run db:start        # alag terminal, chalta rehne do (embedded PostgreSQL :54329)
npm run db:reset
npm test                # current local M6 + C1 baseline: 209 passing
npm run dev:api         # :4000
npm run dev:worker      # reminders/alerts
npm run dev:web         # http://localhost:5180
npm run demo:scenarios  # 9 demo cases; once after reset, with API running
```
Login: login page pe kisi bhi role card pe click. Password (demo only): README me.
DB WIN1252 error aaye toh `var/pgdata` delete karke `db:start` dobara.

---

## 6. Claude ke liye skills aur tools (dusre laptop pe)

| Kaam | Kya use karna hai |
|---|---|
| Milestone banana | Normal Claude Code + `docs/NEXT_PROMPT.md` ka prompt |
| App chala ke check karna | `run` skill / Browser pane (`preview_start`), `.claude/launch.json` me `db`, `api`, `web` |
| Idea/plan stress-test | **court skill**: install karo → `git clone https://github.com/alexyc9381/court-skill` phir `cp -r court-skill/skills/court ~/.claude/skills/` → naya session → `/court --quick <idea>` (11 sub-agent calls, usage khata hai) |
| Code review before commit | `/code-review` |
| PPT edit (national round deck) | `pptx` skill (anthropic-skills:pptx). Template: `docs/sih/SIH2026-IDEA-Presentation-Format.pptx`, current deck: `docs/sih/SIH26262-Idea-Presentation.pptx`. Render karke har slide check karo |
| Demo video (optional) | `hyperframes` / `product-launch-video` skill |

Claude ko ye rules hamesha batao (HANDOFF.md me bhi hain):
- **Commits/docs me koi AI/Claude attribution nahi** (no `Co-Authored-By`).
- Hinglish me short baat.
- System kabhi approve/reject nahi karta; har rule pe label (`APH_CLAUSE` / `ADMIN_INSTRUCTION` / `DEMO_ASSUMPTION`); sab data synthetic; real email/real service kabhi nahi.
- Har step ke baad typecheck/test/build/diff check, PROGRESS + WORK_LOG update, ek local commit aur report; **push nahi**, next step user ke kehne par.

---

## 7. Paste karne wala prompt (dusre laptop ke Claude me)

```text
Main SIH 2026 national round ke liye ye project continue kar raha hoon. Repo: aicte-approval-compliance-platform (PS SIH26262, Team Infera).

Pehle padh: docs/NATIONAL_ROUND_PLAN.md (sabse pehle), docs/HANDOFF.md, AGENTS.md, docs/PROGRESS.md, docs/NEXT_PROMPT.md, aur zarurat ho toh docs/BUILD_PLAN.md.

Rules: commits/docs me koi AI ya Claude attribution mat daalna (no Co-Authored-By). Mujhse Hinglish me short aur easy baat kar.

Kaam:
1. Setup chala (NATIONAL_ROUND_PLAN section 5), npm test pass karwa.
2. M1-M6 aur C1 local checkout me complete hain. Ab NEXT_PROMPT.md ke hisaab se C2 text parser only; phir user ke next kehne par C3 OCR, C4 existing review/highlight, C5 evaluation, phir M7, phir demo prep.
3. Har step ke baad typecheck + test + build + diff check, PROGRESS/WORK_LOG update, ek local commit (push nahi), aur NEXT_PROMPT.md agle step ke liye update. Report karke rukna.
4. Har step ke baad mujhe batana kya hua aur browser me kya click karke check karu.
```

---

## 8. Judges ke likely sawaal (short jawab)

| Sawaal | Jawab |
|---|---|
| Kya system approve karta hai? | Nahi. Sirf authorised officer. System route, remind, record karta hai. |
| AI galat date nikaale toh? | Officer confirm kiye bina koi deadline nahi banti. Hamara measured result: ___ me se ___ sahi (section 4.3 step 6 ka number). |
| AICTE se connected ho? | Nahi. Mock adapter + contract ready hai; real connection ke liye AICTE ki official API chahiye. |
| Server band ho jaye toh? | Deadlines DB me hain; worker restart pe catch-up karta hai, duplicate nahi bhejta. Humne ___ baar kill-test kiya, 0 lost/0 duplicate. |
| Rule badle toh? | Naya policy version publish; purane cases apne version pe; preview pehle dikhta hai. |
| Kitna time bachega? | Hum invented number nahi bolte; pilot me napenge. |
| Data asli hai? | Nahi, sab synthetic. |

Khaali jagah (`___`) apne measured numbers se bharo. Bina measure kiye koi number mat bolna.

---

## 9. Team me kaam kaise baatein (suggestion, apne hisaab se badlo)

| Member | Kaam |
|---|---|
| Arihant Jain | M6 dashboards + reports + CSV |
| Yuvika Mittal | PDF date extraction + accuracy evaluation dataset |
| Alwaz Alam | M6 audit viewer + mock integration/reconciliation |
| Reeshu Singh Rajput | M7 policy impact preview + gap panel + priority queue |
| Mahatva Goel | Demo script, chaos test, rehearsal, national deck update, Q&A prep |

Ek hi file pe do log ek saath kaam na karein; har feature apni branch me, merge se pehle `npm test`.

---

## 10. Files ka map

- Plan (ye file): `docs/NATIONAL_ROUND_PLAN.md`
- Agla step ka prompt: `docs/NEXT_PROMPT.md` (C2 text extraction only)
- Poora spec: `docs/BUILD_PLAN.md` (§11 anchor, §12 EVC/docs, §16 AI, §19 demo, §20 tests, §21 milestones)
- Kya bana hai: `docs/PROGRESS.md`
- Reusable modules: `docs/FOUNDATIONS.md`
- Idea PPT: `docs/sih/SIH26262-Idea-Presentation.pptx` / `.pdf`
- Court verdicts: `docs/sih/court-verdicts/`
- Limitations (honest claims): `docs/LIMITATIONS.md`, pitch: `docs/PITCH.md`
