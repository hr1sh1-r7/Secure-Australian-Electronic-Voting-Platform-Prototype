# SR-13 to SR-16: Ballot Integrity (Muzammil Malek, s4175334)

| Req | What it does | How (Part 2 solution) | Status |
|---|---|---|---|
| SR-13 | One voter, one ballot, nationwide | Voter marked off the electoral roll under a pessimistic write lock (`BEGIN IMMEDIATE`, SQLite's equivalent of `SELECT … FOR UPDATE NOWAIT` in a `SERIALIZABLE` transaction), then a single-use RS256 token with no voter identity | Fully implemented |
| SR-14 | Signed vote batches, signed receipts | Each terminal signs batches with its own Ed25519 key; the Ballot Store returns an Ed25519-signed receipt | Partially implemented: software key behind a `TerminalSigner` interface, not a hardware TPM |
| SR-15 | Independent recount blocks a wrong result | Engine A (JavaScript) and Engine B (Python) share no code; any difference blocks publication and alerts the State Electoral Officer | Fully implemented |
| SR-16 | Keep voting through an outage | AES-256-GCM encrypted, hash-chained SQLite queue on the terminal; forwarded automatically (retry ≤2 min); 12-hour cap; offline voters reconciled against the roll on arrival | Fully implemented |

## Where the code is

| Req | Files |
|---|---|
| SR-13 | `backend/services/ballotIntegrity/markoffCore.js` (lock), `backend/services/markoff.js` (token), `backend/routes/markoff.js`, `backend/scripts/seedElectoralRoll.js` |
| SR-14 | `terminal/src/signer.js`, `terminal/src/sync.js`, `backend/services/terminalRegistry.js`, `backend/services/ballotStore.js`, `backend/routes/terminals.js`, `backend/routes/ballotStore.js` |
| SR-15 | `backend/services/recount/COUNTING_RULES.md` (the only shared artefact), `engineA.js`, `backend/tally-engine-b/engine_b.py`, `backend/services/recount/gate.js`, `backend/routes/recount.js`, `frontend/recount.html` |
| SR-16 | `terminal/src/queue.js`, `terminal/src/sync.js`, `backend/services/ballotStore.js` (chain check, declaration mark-off) |
| Shared | `backend/services/ballotIntegrity/tables.js` (my tables), `canonical.js` (canonical JSON + hash chain), `keys.js` |

## How it connects to the rest of the team's work

- **SR-05 (Caressa):** terminal ballots go into the same `ballots` table (preferences only). Mark-off also writes `voters_voted`, so a voter cannot vote both at a polling place and online.
- **SR-09 (Mmhachio):** every security event goes through `logEvent`, so it is in the hash-chained audit log.
- **SR-10 (Mmhachio):** every terminal ballot gets `recordCvrHash`; both recount engines re-check those SHA-384 hashes before counting.
- **SR-12 (Mmhachio):** `recount.html` uses the existing session and `idleTimeout.js`; recount routes use `requireSession` (admin role).
- **SR-02 (Hrishiraj):** ballot tokens are RS256 with algorithms pinned to `['RS256']`, rejecting `alg: none` and key confusion.

## Running it

```bash
# main backend (from the repo root, .env copied from .env.example)
cd backend
npm install
node scripts/seedCandidates.js
node scripts/seedElectoralRoll.js
npm start                          # http://localhost:3000

# polling terminal (second window)
cd terminal
cp .env.example .env               # set TERMINAL_ENROLMENT_SECRET (same as main .env) and TERMINAL_QUEUE_KEY
npm install
npm start                          # http://127.0.0.1:4100
```

Recount page: log in at `session.html` with role **admin**, then open `recount.html`.

## Tests

- `backend/test/markoff.test.js`: SR-13, including 20 worker threads with separate DB connections racing for one voter (exactly one wins), cross-channel double voting, `alg: none` and tampered tokens.
- `backend/test/ballotStore.test.js`: SR-14 and SR-16 server side (tampered, unsigned, unknown terminal, replayed batches, lost receipts, broken hash chains, offline reconciliation).
- `backend/test/recount.test.js`: SR-15 (hand-checked elections, 150 random elections where both engines must agree, discrepancy blocks publication, tampered ballots blocked).
- `terminal/test/queue.test.js`: SR-16 queue encryption, tamper detection, the 12-hour cap, automatic forwarding, and SR-14 receipt checks.
- `backend/tally-engine-b/test_engine_b.py`: Engine B on its own.

## Known limitations

- No hardware TPM (SR-14). Most TPM 2.0 chips support ECDSA P-256 rather than Ed25519, so a hardware version would likely use ECDSA P-256; the server's verification handles both.
- SQLite locks the whole database for writes rather than one row. This is still pessimistic and serializable, and each mark-off takes milliseconds.
- The online voting route (SR-05) does not check whether voting has closed; SR-15's "ballots changed since count" check still prevents publishing a stale result.
