"""Thin Jinja2 wrapper — avoids Starlette's Jinja2Templates LRU cache incompatibility."""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from fastapi.responses import HTMLResponse

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=True,
)


def render(template_name: str, **ctx) -> HTMLResponse:
    return HTMLResponse(_env.get_template(template_name).render(**ctx))
