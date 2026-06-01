#!/usr/bin/env python3
"""
Gemini research subagent — large context window analysis.
Used by Claude for processing 10-Ks, earnings transcripts, and PDFs
that exceed normal context limits.

Set GEMINI_API_KEY environment variable (Google AI Studio).
Usage:
  python3 tools/gemini_query.py "TICKER" "query" [file1.pdf file2.pdf ...]
  echo "prompt text" | python3 tools/gemini_query.py
"""

import os
import sys
import json


def analyze(ticker: str, query: str, document_paths: list[str] = None) -> str:
    try:
        import google.generativeai as genai
    except ImportError:
        return "ERROR: Install google-generativeai: pip install google-generativeai"

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "ERROR: GEMINI_API_KEY environment variable not set"

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-pro")

    system_prompt = f"""You are a specialized quantitative research agent for the Asymmetry Opportunity Radar.
Analyzing: {ticker}
Focus: {query}

Your job: extract high-signal, non-consensus insights from financial documents.
Be specific. Cite page numbers or section names. Flag anything the market likely hasn't priced in.
Output structured findings, not prose summaries."""

    parts = [system_prompt]

    if document_paths:
        uploaded = []
        for path in document_paths:
            if os.path.exists(path):
                uploaded_file = genai.upload_file(path=path)
                uploaded.append(uploaded_file)
                print(f"[gemini] Uploaded: {path}", file=sys.stderr)
            else:
                print(f"[gemini] Warning: file not found: {path}", file=sys.stderr)
        parts.extend(uploaded)

        response = model.generate_content(parts)

        for f in uploaded:
            try:
                genai.delete_file(f.name)
            except Exception:
                pass
    else:
        response = model.generate_content(parts)

    return response.text


def quick_query(prompt: str) -> str:
    """Fast Gemini Flash query for quick lookups — no file uploads."""
    try:
        import google.generativeai as genai
    except ImportError:
        return "ERROR: Install google-generativeai: pip install google-generativeai"

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "ERROR: GEMINI_API_KEY environment variable not set"

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(prompt)
    return response.text


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        # Pipe mode: read prompt from stdin
        prompt = sys.stdin.read().strip()
        print(quick_query(prompt))
    elif len(args) >= 2:
        ticker = args[0]
        query = args[1]
        files = args[2:] if len(args) > 2 else []
        print(analyze(ticker, query, files))
    else:
        print(f"Usage: {sys.argv[0]} TICKER 'query' [file.pdf ...]")
        print(f"   or: echo 'prompt' | {sys.argv[0]}")
        sys.exit(1)
