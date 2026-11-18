import argparse
import json
from pathlib import Path

from search import DATA, Index


def evaluate():
    index = Index()
    cases = json.loads((DATA / "evals.json").read_text())
    rows = []
    for case in cases:
        hits = index.query(case["query"])
        accepted = index.supported(case["query"], hits)
        top = [p.id for _, p in hits]
        rows.append(
            {
                "query": case["query"],
                "expected": case["expected"],
                "kind": case["kind"],
                "accepted": accepted,
                "top3": top,
                "score": round(hits[0][0], 4),
            }
        )
    known = [r for r in rows if r["kind"] == "answer"]
    missing = [r for r in rows if r["kind"] == "abstain"]
    return {
        "cases": len(rows),
        "answerable": len(known),
        "unanswerable": len(missing),
        "correct_cited_answers": sum(
            r["accepted"] and r["top3"][0] in r["expected"] for r in known
        ),
        "retrieval_hits_at_3": sum(
            bool(set(r["top3"]) & set(r["expected"])) for r in known
        ),
        "correct_abstentions": sum(not r["accepted"] for r in missing),
        "rows": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate()
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps({k: v for k, v in result.items() if k != "rows"}, ensure_ascii=False)
    )
