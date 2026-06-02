#!/usr/bin/env python3
"""
Venice AI client — wraps the OpenAI-compatible Venice API.
Model: kimi-k2-5 (Moonshot's Kimi K2, Venice-hosted)
Web search: enabled via venice_parameters — used for real-time market data.
"""

import os
import requests
from typing import Optional


class VeniceClient:
    BASE_URL = "https://api.venice.ai/api/v1"
    DEFAULT_MODEL = "kimi-k2-5"

    def __init__(self, api_key: Optional[str] = None):
        key = api_key or os.getenv("VENICE_API_KEY")
        if not key:
            raise ValueError("VENICE_API_KEY not set")
        self.headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def chat(
        self,
        prompt: str,
        web_search: bool = True,
        model: str = DEFAULT_MODEL,
        max_tokens: int = 1500,
        system: Optional[str] = None,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "venice_parameters": {
                "enable_web_search": "auto" if web_search else "off",
            },
        }

        resp = requests.post(
            f"{self.BASE_URL}/chat/completions",
            headers=self.headers,
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def bull_case(self, ticker: str, data_block: str) -> str:
        prompt = f"""You are a BULL ADVOCATE for ${ticker} on the Asymmetry Opportunity Radar.
{data_block}

Your mission: Make the strongest possible BULL case for this stock (200-300 words).
1. Search for the most recent news, contract wins, regulatory approvals, partnerships
2. Identify the specific catalyst that could drive 3x+ upside in 12-18 months
3. Explain what the market is missing or undervaluing about this company
4. Point to any insider buying, institutional accumulation, or analyst upgrades

Be specific and cite recent evidence. No vague assertions.

End with exactly:
BULL TARGET: $XX
TIMEFRAME: XX months
CONVICTION: HIGH/MEDIUM/LOW"""
        return self.chat(prompt, web_search=True)

    def bull_rebuttal(self, ticker: str, bear_case: str) -> str:
        prompt = f"""${ticker} — the bear analyst raised these concerns:

{bear_case}

You are the BULL advocate. Rebut each bear point in 150-200 words.
Search for recent evidence that directly contradicts the bear thesis.
What does the bear miss? What catalysts does the bear ignore or underweight?
Which bear assumptions are stale or wrong given recent developments?"""
        return self.chat(prompt, web_search=True)

    def search_web(self, query: str) -> str:
        return self.chat(query, web_search=True)

    def scrape_url(self, url: str) -> str:
        prompt = f"Extract the key financial and business information from this URL: {url}"
        return self.chat(prompt, web_search=True)


if __name__ == "__main__":
    import sys
    import json
    ticker = sys.argv[1] if len(sys.argv) > 1 else "ASTS"
    client = VeniceClient()

    # Quick bull case test with mock data
    data_block = f"Ticker: ${ticker} | Price: $N/A | Market Cap: N/A | Rev Growth: N/A | Gross Margin: N/A"
    result = client.bull_case(ticker, data_block)
    print(result)
