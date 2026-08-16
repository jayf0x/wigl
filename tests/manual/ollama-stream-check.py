#!/usr/bin/env python3
"""Isolates where LocalCode's "Ollama replies arrive in one dump" symptom
actually lives: Ollama's HTTP layer, or opencode's SSE relay on top of it.

No synthetic input, no GUI — plain HTTP against a local `ollama serve` and a
throwaway `opencode serve`. Safe to run anytime either is already running or
not; this script starts/stops its own `opencode serve` and leaves any
pre-existing `ollama serve` alone.

Usage:
    ollama serve &                      # if not already running
    python3 scripts/dev/ollama-stream-check.py [model]

Requires `opencode` and `ollama` on PATH, and at least one Ollama model
pulled (`ollama list`). Prints two independent measurements and a verdict.
See wigl-widgets/LocalCode/AGENTS.md's "Server lifecycle — known rough
edges" for how this result is used.
"""

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "qwen3.5:0.8b"
PROMPT = "Count from 1 to 20, one number per line. Do not use any tools."
PORT_RE = re.compile(r"listening on http://127\.0\.0\.1:(\d+)")


def gap_stats(times):
    if len(times) < 2:
        return "n/a (fewer than 2 events)"
    gaps = [times[i] - times[i - 1] for i in range(1, len(times))]
    return f"first={times[0]:.2f}s last={times[-1]:.2f}s max_gap={max(gaps):.2f}s median_gap={sorted(gaps)[len(gaps) // 2]:.3f}s"


def require_ollama():
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3)
    except Exception:
        print(f"ollama isn't reachable at {OLLAMA_URL} — start it with `ollama serve` first.")
        sys.exit(1)


# --- Step 1: Ollama's own OpenAI-compatible endpoint, no opencode involved ---
def check_ollama_direct():
    print(f"=== 1. Ollama /v1/chat/completions directly (model={MODEL}) ===")
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": True,
        # opencode always sends a tool schema when the agent has any tools
        # granted — include one here so this matches what opencode actually
        # sends, not the easier no-tools case.
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read a file",
                    "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
                },
            }
        ],
    }
    req = urllib.request.Request(
        f"{OLLAMA_URL}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    times = []
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        for line in resp:
            line = line.decode(errors="replace").strip()
            if line.startswith("data:") and line != "data: [DONE]":
                times.append(time.time() - t0)
    except urllib.error.HTTPError as e:
        print(f"  request failed: {e.code} {e.read().decode(errors='replace')[:300]}")
        return None
    print(f"  {len(times)} SSE chunks, {gap_stats(times)}")
    return times


# --- Step 2: the same prompt through a real opencode serve, watching /event ---
def check_via_opencode():
    print("\n=== 2. Same model through `opencode serve`'s /event feed ===")
    proc = subprocess.Popen(
        ["opencode", "serve", "--port", "0", "--print-logs", "--log-level", "DEBUG"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    port = None
    deadline = time.time() + 15
    try:
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                continue
            m = PORT_RE.search(line)
            if m:
                port = int(m.group(1))
                break
        if port is None:
            print("  opencode serve never printed its port — aborting this half of the check.")
            return None

        base = f"http://127.0.0.1:{port}"
        time.sleep(0.5)  # let the server finish booting past the port line
        sid = json.loads(
            urllib.request.urlopen(
                urllib.request.Request(f"{base}/session", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
            ).read()
        )["id"]

        events = []
        listener = subprocess.Popen(["curl", "-sN", f"{base}/event"], stdout=subprocess.PIPE)
        t0 = time.time()

        import threading

        def pump():
            for raw in iter(listener.stdout.readline, b""):
                line = raw.decode(errors="replace").strip()
                if line.startswith("data:"):
                    try:
                        events.append((time.time() - t0, json.loads(line[5:].strip())))
                    except Exception:
                        pass

        th = threading.Thread(target=pump, daemon=True)
        th.start()
        time.sleep(1)

        body = json.dumps(
            {
                "model": {"providerID": "ollama", "modelID": MODEL},
                "parts": [{"type": "text", "text": PROMPT}],
            }
        ).encode()
        req = urllib.request.Request(f"{base}/session/{sid}/message", data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=120)
        except Exception as e:
            print(f"  message request failed: {e}")
        time.sleep(1)
        listener.kill()

        deltas = [t for t, e in events if e.get("type") == "message.part.delta"]
        updates = [
            t
            for t, e in events
            if e.get("type") == "message.part.updated" and e.get("properties", {}).get("part", {}).get("type") == "text"
        ]
        print(f"  {len(deltas)} message.part.delta events: {gap_stats(deltas)}")
        print(f"  {len(updates)} message.part.updated(text) events: {gap_stats(updates)}")
        return deltas, updates
    finally:
        proc.kill()
        proc.wait()


def main():
    require_ollama()
    direct = check_ollama_direct()
    via_opencode = check_via_opencode()

    print("\n=== Verdict ===")
    if direct and len(direct) > 5:
        span = direct[-1] - direct[0]
        print(f"Ollama's own HTTP layer streamed {len(direct)} chunks over {span:.2f}s — genuinely incremental.")
    else:
        print("Ollama's own HTTP layer did not show incremental chunks — investigate Ollama/model config first.")

    if via_opencode:
        deltas, updates = via_opencode
        total_incremental = len(deltas) + len(updates)
        if total_incremental <= 2:
            print("opencode's /event feed delivered the reply as one end-of-turn burst, not incrementally.")
            print("This matches known upstream opencode+Ollama reports, not a wigl-side bug:")
            print("  https://github.com/anomalyco/opencode/issues/22132")
            print("  https://github.com/anomalyco/opencode/issues/28800")
        else:
            print("opencode's /event feed delivered multiple incremental events — streaming looks fine here.")
            print("If LocalCode still shows one dump, the bug is more likely in the widget's own event handling.")


if __name__ == "__main__":
    main()
