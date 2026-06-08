import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from database import init_db
from routers import ingest, recipes, shopping, reminders, cook_log

app = FastAPI(title="Asymmetry", docs_url="/api/docs")

app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

app.include_router(recipes.router)
app.include_router(ingest.router)
app.include_router(shopping.router)
app.include_router(reminders.router)
app.include_router(cook_log.router)


@app.on_event("startup")
def on_startup():
    init_db()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
