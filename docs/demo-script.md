# Demo video script — about 2:40

Record at 1080p (720p minimum) in a clean browser window at 110–125% zoom, so the text is readable.
Before recording, open these tabs:
1. https://obelus-five.vercel.app
2. The Apex Fusion AP3X report (Example B): https://obelus-five.vercel.app/r/ArfJ6uZePE
3. Telegram with @Obelus_the_Bot, or a group it's in

Have `fixtures/sample1.txt` (the labelled test announcement) on the clipboard.

---

### 0:00 — the problem (20 s)

**Screen:** a Chainwire press release scrolling. Stop on a line like "listed on…" or "audited by…".

**Say:** "Crypto press releases are paid to appear on dozens of sites. A study of nearly 2,900 of them
found only about 2% had real news. They say 'listed on BingX', 'audited by CertiK', 'partnered with…',
and nobody checks, because checking each claim takes an afternoon."

### 0:20 — paste and watch it check (35 s)

**Screen:** paste the test announcement into Obelus and click **Check announcement**. Let the trace
stream on screen.

**Say:** "Obelus takes an X post, a link or the text. This is a test announcement we wrote about a real
Base token, and it's labelled as a test. A model reads out each claim with its exact quote. That's all
the model does. Every verdict comes from code reading the one source that can confirm the claim."

### 0:55 — the marks and their proof (45 s)

**Screen:** the report. Hover over each mark in turn.

- **WEEX listing, verified:** click the proof. "WEEX's own API lists AERO, and the contract WEEX
  publishes is the one in the announcement. That's how Obelus catches the same-ticker scam."
- **BingX listing:** "Live on BingX too, but BingX publishes no contract address, so Obelus says so
  instead of guessing."
- **CertiK audit, contradicted:** click the proof. "CertiK's own page says 'Not Audited By CertiK'."
- **Partnership, unverified:** "Chainlink's own site doesn't mention it. That's unverified, not false.
  Absence of proof is never a contradiction."

### 1:40 — the receipt on Base (20 s)

**Screen:** click **view the attestation** (EAS explorer), go back, then click **Verify this report**
and let it show the match.

**Say:** "Every report is fingerprinted on Base. Your browser re-hashes the report and compares it
with the chain, so if anyone edits a report, it shows."

### 2:00 — Telegram (20 s)

**Screen:** in Telegram, reply `/check` to a message that contains an announcement link. The reply
changes from "Checking…" to the marks.

**Say:** "In a group, reply /check to any shill and everyone sees what holds up, before anyone buys."

### 2:20 — a real one, and what's next (20 s)

**Screen:** click **"A real listing that no longer holds"** on the home page.

**Say:** "And a real one. This release says Apex Fusion's AP3X is listed on MEXC, and it's still on three
news sites. MEXC's own list says it isn't any more. Next: more exchanges that publish contract addresses,
more auditors and more chains. Obelus: for two thousand years this mark has meant 'this line doesn't hold
up.'"

---

**Checks before recording:**
- `/api/health` is all green.
- The receipt line reads "Base", not the test network, if the mainnet switch is done.
- The rate limit isn't hit. Do a practice run first, or record in one take.
