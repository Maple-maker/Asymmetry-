import re
import httpx
from bs4 import BeautifulSoup


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    )
}

PLATFORM_PATTERNS = {
    "instagram": r"instagram\.com",
    "tiktok": r"tiktok\.com",
    "youtube": r"(youtube\.com|youtu\.be)",
    "web": r".*",
}


def detect_platform(url: str) -> str:
    for platform, pattern in PLATFORM_PATTERNS.items():
        if re.search(pattern, url, re.IGNORECASE):
            return platform
    return "other"


async def scrape_url(url: str) -> dict:
    """Fetch a URL and return title, description, image_url, text_content, platform."""
    result = {
        "title": None,
        "description": None,
        "image_url": None,
        "text_content": "",
        "platform": detect_platform(url),
        "source_url": url,
    }

    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as e:
        result["text_content"] = f"[scrape failed: {e}]"
        return result

    soup = BeautifulSoup(resp.text, "lxml")

    # og: tags first (most reliable)
    def og(prop):
        tag = soup.find("meta", property=f"og:{prop}") or soup.find("meta", attrs={"name": f"og:{prop}"})
        return tag["content"].strip() if tag and tag.get("content") else None

    result["title"] = og("title") or (soup.title.string.strip() if soup.title else None)
    result["description"] = og("description")
    result["image_url"] = og("image")

    # Pull main page text — remove nav/footer/script noise
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    # Collapse whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    result["text_content"] = text[:6000]  # cap for LLM context

    return result
