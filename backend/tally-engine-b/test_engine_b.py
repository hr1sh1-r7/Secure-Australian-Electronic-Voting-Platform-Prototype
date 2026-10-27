"""Unit tests for Engine B (SR-15). Run from backend/tally-engine-b:
    python -m unittest -v test_engine_b
"""

import hashlib
import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import engine_b  # noqa: E402


def make(candidates, ballots):
    cvrs = []
    for i, prefs in enumerate(ballots, start=1):
        text = json.dumps(prefs, separators=(",", ":"))
        h = hashlib.sha384(("CVR|%d|%s" % (i, text)).encode()).hexdigest()
        cvrs.append({"ballot_id": i, "preferences_json": text, "cvr_hash": h})
    return {"candidates": candidates, "cvrs": cvrs}


class EngineBTests(unittest.TestCase):
    def test_majority_first_round(self):
        r = engine_b.count(make([1, 2], [[1], [1], [2]]))
        self.assertEqual(r["winner"], 1)
        self.assertEqual(len(r["rounds"]), 1)

    def test_preference_flow(self):
        r = engine_b.count(make([1, 2, 3], [[1, 2]] * 4 + [[2, 3]] * 3 + [[3, 2]] * 2))
        self.assertEqual(r["rounds"][0]["excluded"], 3)
        self.assertEqual(r["rounds"][1]["counts"], {"1": 4, "2": 5})
        self.assertEqual(r["winner"], 2)

    def test_backward_tie_break(self):
        r = engine_b.count(make([1, 2, 3, 4], [[1]] * 5 + [[2]] * 4 + [[4]] * 3 + [[3, 4], [3, 1]]))
        self.assertEqual(r["rounds"][1]["excluded"], 4)
        self.assertEqual(r["winner"], 1)

    def test_highest_id_tie_break(self):
        r = engine_b.count(make([1, 2, 3], [[1], [1], [2], [3]]))
        self.assertEqual(r["rounds"][0]["excluded"], 3)

    def test_tampered_cvr_refused(self):
        data = make([1, 2], [[1], [2]])
        data["cvrs"][0]["preferences_json"] = "[2]"
        self.assertEqual(engine_b.count(data)["error"], "INTEGRITY_FAILURE")

    def test_missing_hash_refused(self):
        data = make([1, 2], [[1]])
        data["cvrs"][0]["cvr_hash"] = None
        self.assertEqual(engine_b.count(data)["ballot_ids"], [1])

    def test_cli_reads_stdin(self):
        out = subprocess.run(
            [sys.executable, "-I", os.path.join(os.path.dirname(__file__), "engine_b.py")],
            input=json.dumps(make([1, 2], [[2], [2], [1]])), capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(out.stdout)["winner"], 2)


if __name__ == "__main__":
    unittest.main()
