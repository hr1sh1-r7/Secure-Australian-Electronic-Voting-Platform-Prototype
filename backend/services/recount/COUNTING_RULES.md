# Preferential Counting Rules (SR-15)

**Owner:** Muzammil Malek (s4175334)

This document is the **only** thing the two counting engines share.
Engine A (`engineA.js`, JavaScript) and Engine B
(`backend/tally-engine-b/engine_b.py`, Python) were each written from this
spec and share no counting code. If they disagree, at least one is faulty or
has been tampered with, and publication is blocked.

## Input

```json
{
  "candidates": [1, 2, 3, 4],
  "cvrs": [
    { "ballot_id": 7, "preferences_json": "[3,1]", "cvr_hash": "<sha384 hex or null>" }
  ]
}
```

`preferences_json` is the exact string stored in the `ballots` table (SR-05);
`cvr_hash` comes from `cvr_hashes` (SR-10).

## Rules

1. **Integrity.** For every CVR recompute
   `SHA-384("CVR|" + ballot_id + "|" + preferences_json)` (lowercase hex, the
   same formula as SR-10's `hashCvr`). If any hash is missing or different,
   stop and return `{"error": "INTEGRITY_FAILURE", "ballot_ids": [...ascending]}`.
2. **Formality.** A ballot is informal if its preferences are not a non-empty
   list of distinct candidate IDs from `candidates`. Informal ballots are
   counted in `informal` and otherwise ignored.
3. **Rounds.** All candidates start as continuing. Each round, every formal
   ballot counts for its highest-ranked continuing candidate. A ballot with no
   continuing candidate left is exhausted.
4. **Election.** `total` = votes for continuing candidates this round. A
   candidate with `votes * 2 > total` is elected and counting stops.
5. **No votes.** If `total` is 0, there is no winner and counting stops.
6. **Exclusion.** Otherwise exclude the continuing candidate with the fewest
   votes. If several tie on fewest:
   1. look back through earlier rounds, most recent first, keeping only the
      tied candidates with the fewest votes in that round, until one remains;
   2. if still tied, exclude the candidate with the **highest ID**
      (a deterministic stand-in for drawing lots).
7. Repeat from rule 3.

## Output

```json
{
  "formal": 7, "informal": 0, "winner": 3,
  "rounds": [
    { "round": 1, "counts": { "1": 2, "2": 1, "3": 3, "4": 1 },
      "exhausted": 0, "total": 7, "excluded": 4, "elected": null }
  ]
}
```

`counts` lists continuing candidates only, keyed by candidate ID as a string.
Outputs are compared as canonical JSON (sorted keys), so key order does not
matter. Any difference, even one vote in one round, blocks publication.
