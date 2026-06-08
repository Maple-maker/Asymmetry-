import json
import os
import anthropic

_client = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


PARSE_PROMPT = """\
You are extracting a recipe from web content. Return ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "title": "string or null",
  "total_time_minutes": integer_or_null,
  "servings": integer_or_null,
  "source_platform": "instagram|tiktok|youtube|web|other",
  "ingredients": [
    {"qty": float_or_null, "unit": "string_or_null", "item": "string", "prep": "string_or_null", "aisle": "produce|dairy|meat|pantry|frozen|other"}
  ],
  "steps": ["string", ...]
}

Rules:
- qty: numeric only (e.g. 2.0, 0.5) or null if not given
- unit: cups/tbsp/tsp/oz/g/kg/lbs/ml/l/cloves/pinch/slice/can/bunch/sprig or null for whole items
- item: ingredient name, lowercase singular
- prep: e.g. "minced", "diced", "sliced", "room temperature" — or null
- aisle: best guess at grocery store aisle
- steps: plain instruction strings, no numbering
- If this is NOT a recipe: return {"error": "not a recipe"}
- If fields are missing, use null — never omit fields from the schema
"""


async def parse_recipe(
    title: str | None,
    description: str | None,
    text_content: str,
    platform: str = "other",
) -> dict:
    """Send content to Claude Haiku and return parsed recipe dict."""
    user_content = f"""Platform: {platform}
Title: {title or 'unknown'}
Description: {description or 'none'}

Page content:
{text_content[:4000]}
"""

    client = get_client()
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=2048,
        system=PARSE_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if the model wraps anyway
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": f"invalid json: {raw[:200]}"}
