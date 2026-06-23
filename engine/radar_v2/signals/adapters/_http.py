"""Tiny shared HTTP helper for the free-source adapters.

Keeps a polite default User-Agent and a short timeout. Every adapter that does
network I/O should funnel through here so behaviour (timeouts, headers) is
consistent and easy to change in one place.
"""

import requests

# A descriptive User-Agent is required by SEC and is good manners elsewhere.
DEFAULT_HEADERS = {
    "User-Agent": "Asymmetry Radar (research@asymmetry.app)",
    "Accept": "application/json",
}


def get_json(url: str, *, params: dict | None = None, headers: dict | None = None, timeout: int = 20):
    """GET a URL and return parsed JSON, or None on any failure.

    Adapters treat None as "no data" and return [] — one dead source never
    kills a scan (adapter contract, spec §2).
    """
    try:
        resp = requests.get(url, params=params, headers=headers or DEFAULT_HEADERS, timeout=timeout)
        if not resp.ok:
            return None
        return resp.json()
    except Exception:
        return None


def post_json(url: str, *, json_body: dict, headers: dict | None = None, timeout: int = 20):
    """POST a JSON body and return parsed JSON, or None on any failure."""
    try:
        resp = requests.post(url, json=json_body, headers=headers or DEFAULT_HEADERS, timeout=timeout)
        if not resp.ok:
            return None
        return resp.json()
    except Exception:
        return None
