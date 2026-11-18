import argparse
import json
import os
import re
from pathlib import Path

from search import DATA, Index, answer, normalize


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
                "score": round(hits[0][0], 4) if hits else None,
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


def normalized_phrase(text):
    return " " + " ".join(re.findall(r"[a-z0-9]+", normalize(text))) + " "


def grade_content(case, result, passages):
    evidence = result["evidence"]
    selected = evidence[0]["id"] if evidence else None
    text = result["answer"]
    answered = result["state"] == "answered"
    source_ok = answered and selected in case["expected"]
    literal = bool(
        answered and selected in passages and text
        and text == evidence[0]["quote"] and text in passages[selected]
    )
    normalized = normalized_phrase(text)
    missing = [fact for fact in case["facts"] if normalized_phrase(fact) not in normalized]
    passed = (source_ok and literal and not missing) if case["expected"] else (
        result["state"] == "abstained" and not evidence
    )
    return {
        "id": case["id"], "query": case["query"], "expected": case["expected"],
        "selected": selected, "state": result["state"], "mode": result["mode"],
        "source_correct": source_ok, "literal": literal, "missing_facts": missing,
        "answer": text, "pass": passed,
    }


def evaluate_content(use_model=False):
    index = Index()
    passages = {p.id: p.text for p in index.passages}
    cases = json.loads((DATA / "content-cases.json").read_text())
    rows = [
        grade_content(case, answer(index, case["query"], use_model=use_model), passages)
        for case in cases
    ]
    known = [r for r in rows if r["expected"]]
    unknown = [r for r in rows if not r["expected"]]
    return {
        "suite": "content", "model": os.environ["LLM_MODEL"] if use_model else None,
        "cases": len(rows), "answerable": len(known), "unanswerable": len(unknown),
        "correct_cited_answers": sum(r["source_correct"] for r in known),
        "complete_grounded_answers": sum(r["pass"] for r in known),
        "correct_abstentions": sum(r["pass"] for r in unknown),
        "passed": sum(r["pass"] for r in rows), "rows": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", choices=["retrieval", "content"], default="retrieval")
    parser.add_argument("--model", action="store_true", help="Avaliar o modelo configurado na suíte de conteúdo")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.model and (
        args.suite != "content" or not os.getenv("LLM_BASE_URL") or not os.getenv("LLM_MODEL")
    ):
        parser.error("--model requer --suite content, LLM_BASE_URL e LLM_MODEL")
    result = evaluate_content(args.model) if args.suite == "content" else evaluate()
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps({k: v for k, v in result.items() if k != "rows"}, ensure_ascii=False)
    )
