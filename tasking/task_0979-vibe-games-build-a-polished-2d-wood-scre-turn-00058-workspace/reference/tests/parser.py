#!/usr/bin/env python3
"""Deterministic result parser for task_0010-vibe-games-build-a-polished-2d-wood-scre-turn-00058.

Reward is 1 only when Playwright exited 0 and EVERY test passed — both the
[F2P] fail-to-pass tests (red on broken, green on fixed) and the [P2P]
pass-to-pass guard tests. The reward.json also reports how many of each ran.
"""
import json
import os
import re
import sys

_LOG_DIR = os.environ.get("SAND_LOG_DIR", "/logs/verifier")
LOG = os.path.join(_LOG_DIR, "test_output.txt")
REWARD_TXT = os.path.join(_LOG_DIR, "reward.txt")
REWARD_JSON = os.path.join(_LOG_DIR, "reward.json")


def _write(reward, counts):
    payload = {"reward": int(reward), **counts}
    for path, body in ((REWARD_JSON, json.dumps(payload) + "\n"), (REWARD_TXT, f"{int(reward)}\n")):
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(body)
        except OSError:
            pass
    return payload


def _find_json(text):
    m = re.search(r"PLAYWRIGHT_JSON=(\S+)", text)
    if m and os.path.isfile(m.group(1)):
        return m.group(1)
    fb = os.path.join(_LOG_DIR, "playwright_results.json")
    return fb if os.path.isfile(fb) else None


def _iter_specs(report):
    def walk(suite):
        yield from suite.get("specs", []) or []
        for child in suite.get("suites", []) or []:
            yield from walk(child)
    for suite in report.get("suites", []) or []:
        yield from walk(suite)


def _spec_passed(spec):
    tests = spec.get("tests", []) or []
    if not tests:
        return False
    for t in tests:
        results = t.get("results", []) or []
        if not results or results[-1].get("status") != "passed":
            return False
    return True


def _results_from_json(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        report = json.load(fh)
    return {spec.get("title", ""): _spec_passed(spec) for spec in _iter_specs(report)}


def _results_from_text(text):
    results = {}
    pattern = re.compile(r"\[(F2P|P2P)\][^\n]*")
    for line in text.splitlines():
        m = pattern.search(line)
        if not m:
            continue
        title = m.group(0).strip()
        if any(g in line for g in ("✓", "✔")):
            results[title] = True
        elif any(g in line for g in ("✘", "✗", "×")) or re.search(r"\bfailed\b", line, re.I):
            results[title] = False
    return results


def _counts(results):
    f2p = [p for title, p in results.items() if title.startswith("[F2P]")]
    p2p = [p for title, p in results.items() if title.startswith("[P2P]")]
    return f2p, p2p


def main():
    try:
        with open(LOG, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except FileNotFoundError:
        print("FAIL: verifier output not found")
        _write(0, {})
        return 1
    if "TEST_INTEGRITY=FAIL" in text:
        print("FAIL: protected test files were modified")
        _write(0, {})
        return 1
    m = re.search(r"PLAYWRIGHT_EXIT=(\d+)", text)
    if not m:
        print("FAIL: Playwright did not run to completion")
        _write(0, {})
        return 1
    exit_code = int(m.group(1))
    results = {}
    jp = _find_json(text)
    if jp:
        try:
            results = _results_from_json(jp)
        except (json.JSONDecodeError, OSError, KeyError, TypeError):
            results = {}
    if not results:
        results = _results_from_text(text)
    f2p, p2p = _counts(results)
    counts = {"f2p_total": len(f2p), "f2p_passed": sum(f2p),
              "p2p_total": len(p2p), "p2p_passed": sum(p2p)}
    # reward only if the app ran clean AND every test (F2P and P2P) passed
    all_pass = bool(results) and all(results.values())
    reward = 1 if (exit_code == 0 and all_pass) else 0
    payload = _write(reward, counts)
    print(("PASS" if reward else "FAIL") + f": REWARD_JSON={json.dumps(payload)}")
    return 0 if reward else 1


if __name__ == "__main__":
    sys.exit(main())
