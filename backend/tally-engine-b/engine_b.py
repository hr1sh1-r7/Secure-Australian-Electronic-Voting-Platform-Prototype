#!/usr/bin/env python3
"""SR-15 Engine B: independent preferential count in Python.

Owner: Muzammil Malek (s4175334)

Implements backend/services/recount/COUNTING_RULES.md and shares no code with
Engine A (backend/services/recount/engineA.js). It also uses a different
strategy: ballots are kept in "piles" by their current candidate, and only the
excluded candidate's pile is redistributed each round.

Reads the input JSON on stdin and writes the result JSON on stdout.
Standard library only, so there is no third-party supply chain.
"""

import hashlib
import json
import sys


def _hash_ok(cvr):
    if not cvr.get("cvr_hash"):
        return False
    text = "CVR|%s|%s" % (cvr["ballot_id"], cvr["preferences_json"])
    return hashlib.sha384(text.encode("utf-8")).hexdigest() == cvr["cvr_hash"]


def _parse(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def _formal(prefs, valid):
    return (
        isinstance(prefs, list)
        and len(prefs) > 0
        and all(type(p) is int for p in prefs)
        and len(set(prefs)) == len(prefs)
        and all(p in valid for p in prefs)
    )


def _next_choice(prefs, start, continuing):
    for i in range(start, len(prefs)):
        if prefs[i] in continuing:
            return i
    return None


def _break_tie(tied, past_rounds):
    remaining = list(tied)
    for earlier in reversed(past_rounds):
        if len(remaining) == 1:
            break
        fewest = min(earlier[c] for c in remaining)
        remaining = [c for c in remaining if earlier[c] == fewest]
    return max(remaining)  # still tied: highest candidate ID is excluded


def count(data):
    candidates = list(data["candidates"])
    cvrs = data["cvrs"]

    bad = sorted(c["ballot_id"] for c in cvrs if not _hash_ok(c))
    if bad:
        return {"error": "INTEGRITY_FAILURE", "ballot_ids": bad}

    valid = set(candidates)
    formal = [p for p in (_parse(c["preferences_json"]) for c in cvrs) if _formal(p, valid)]

    continuing = set(candidates)
    piles = {c: [] for c in candidates}  # candidate -> [(ballot index, position)]
    exhausted = 0
    for idx, prefs in enumerate(formal):
        pos = _next_choice(prefs, 0, continuing)
        if pos is None:
            exhausted += 1
        else:
            piles[prefs[pos]].append((idx, pos))

    rounds, past, winner, number = [], [], None, 0
    while True:
        number += 1
        tally = {c: len(piles[c]) for c in continuing}
        total = sum(tally.values())
        record = {
            "round": number,
            "counts": {str(c): v for c, v in tally.items()},
            "exhausted": exhausted,
            "total": total,
            "excluded": None,
            "elected": None,
        }
        rounds.append(record)

        majority = [c for c, v in tally.items() if 2 * v > total]
        if majority:
            winner = record["elected"] = majority[0]
            break
        if total == 0:
            break

        low = min(tally.values())
        out = _break_tie([c for c, v in tally.items() if v == low], past)
        record["excluded"] = out
        past.append(tally)

        continuing.discard(out)
        for idx, pos in piles.pop(out):
            nxt = _next_choice(formal[idx], pos + 1, continuing)
            if nxt is None:
                exhausted += 1
            else:
                piles[formal[idx][nxt]].append((idx, nxt))

    return {"formal": len(formal), "informal": len(cvrs) - len(formal), "winner": winner, "rounds": rounds}


def main():
    json.dump(count(json.load(sys.stdin)), sys.stdout)


if __name__ == "__main__":
    main()
