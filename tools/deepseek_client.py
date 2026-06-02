#!/usr/bin/env python3
"""
DeepSeek client — wraps the OpenAI-compatible DeepSeek API.
Models:
  deepseek-chat     (V3)  — fast, strong general reasoning (~$0.27/1M tokens)
  deepseek-reasoner (R1)  — chain-of-thought, best for complex analysis (~$0.55/1M tokens)

Get your API key at: https://platform.deepseek.com/
Set: export DEEPSEEK_API_KEY=your_key_here
"""

import os
import requests
from typing import Optional


class DeepSeekClient:
    BASE_URL = "https://api.deepseek.com/v1"
    DEFAULT_MODEL = "deepseek-chat"

    def __init__(self, api_key: Optional[str] = None):
        key = api_key or os.getenv("DEEPSEEK_API_KEY")
        if not key:
            raise ValueError("DEEPSEEK_API_KEY not set")
        self.headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def chat(
        self,
        prompt: str,
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
        }

        resp = requests.post(
            f"{self.BASE_URL}/chat/completions",
            headers=self.headers,
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def bear_case(self, ticker: str, data_block: str) -> str:
        prompt = f"""You are a QUANTITATIVE BEAR ANALYST stress-testing ${ticker}.
{data_block}

Your mission: Find every reason this stock is overvalued or at risk (200-300 words).
1. Is the current valuation multiple justified vs peer group? Show the math.
2. Is revenue growth durable or a one-time event? What does the next 4 quarters look like?
3. Are margins expanding or compressing? What's the trajectory?
4. What is the single most dangerous competitive threat in the next 24 months?
5. Identify any balance sheet, customer concentration, or execution risks.

Be specific with numbers. No vague concerns — every claim needs a number behind it.

End with exactly:
BEAR TARGET: $XX
PRIMARY RISK: [one sentence]
VERDICT: AVOID/CAUTION/NEUTRAL"""
        return self.chat(prompt)

    def bear_rebuttal(self, ticker: str, bull_case: str) -> str:
        prompt = f"""${ticker} — the bull analyst made this case:

{bull_case}

You are the BEAR analyst. Stress-test each bull assumption in 150-200 words.
1. What is the probability each stated catalyst actually materializes?
2. Where are the growth numbers misleading or unsustainable?
3. What does competitive pressure look like in 18 months?
4. Which bull assumption, if wrong, breaks the entire thesis?

Be quantitative and specific. No ad-hominem attacks on the bull — attack the assumptions."""
        return self.chat(prompt)

    def deep_analysis(self, ticker: str, data_block: str) -> str:
        """Slower but deeper analysis using DeepSeek R1 chain-of-thought."""
        return self.chat(
            f"Perform a comprehensive financial analysis of ${ticker}:\n{data_block}",
            model="deepseek-reasoner",
            max_tokens=2000,
        )


if __name__ == "__main__":
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else "ASTS"
    client = DeepSeekClient()

    data_block = f"Ticker: ${ticker} | Price: $N/A | Market Cap: N/A | Rev Growth: N/A | Gross Margin: N/A"
    result = client.bear_case(ticker, data_block)
    print(result)
