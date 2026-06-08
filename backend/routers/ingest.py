from fastapi import APIRouter, BackgroundTasks, HTTPException
from models import IngestRequest
from database import get_db
from services.scraper import scrape_url
from services.parser import parse_recipe

router = APIRouter(prefix="/api")


async def _process_recipe(recipe_id: int, url: str | None, raw_text: str | None):
    """Background task: scrape → parse → write structured fields."""
    db = get_db()
    db.execute("UPDATE recipes SET status='processing' WHERE id=?", (recipe_id,))
    db.commit()

    try:
        if url:
            scraped = await scrape_url(url)
            title = scraped["title"]
            description = scraped["description"]
            text_content = scraped["text_content"]
            platform = scraped["platform"]
            thumbnail_url = scraped["image_url"]
            source_url = scraped["source_url"]
        else:
            title = None
            description = None
            text_content = raw_text or ""
            platform = "other"
            thumbnail_url = None
            source_url = None

        parsed = await parse_recipe(title, description, text_content, platform)

        if "error" in parsed:
            db.execute(
                "UPDATE recipes SET status='error', parse_error=? WHERE id=?",
                (parsed["error"], recipe_id),
            )
            db.commit()
            db.close()
            return

        # Update recipe row
        db.execute(
            """UPDATE recipes SET
                title=?, total_time_minutes=?, servings=?,
                source_platform=?, thumbnail_url=?, source_url=?, status='ready'
               WHERE id=?""",
            (
                parsed.get("title") or title,
                parsed.get("total_time_minutes"),
                parsed.get("servings"),
                parsed.get("source_platform", platform),
                thumbnail_url,
                source_url or url,
                recipe_id,
            ),
        )

        # Insert ingredients
        for ing in parsed.get("ingredients", []):
            db.execute(
                "INSERT INTO ingredients (recipe_id, qty, unit, item, prep, aisle) VALUES (?,?,?,?,?,?)",
                (
                    recipe_id,
                    ing.get("qty"),
                    ing.get("unit"),
                    ing.get("item", ""),
                    ing.get("prep"),
                    ing.get("aisle", "other"),
                ),
            )

        # Insert steps
        for i, step in enumerate(parsed.get("steps", []), start=1):
            db.execute(
                "INSERT INTO steps (recipe_id, step_number, instruction) VALUES (?,?,?)",
                (recipe_id, i, step),
            )

        db.commit()

    except Exception as e:
        db.execute(
            "UPDATE recipes SET status='error', parse_error=? WHERE id=?",
            (str(e), recipe_id),
        )
        db.commit()
    finally:
        db.close()


@router.post("/ingest", status_code=202)
async def ingest(req: IngestRequest, bg: BackgroundTasks):
    if not req.url and not req.text:
        raise HTTPException(400, "Provide url or text")

    db = get_db()
    cur = db.execute(
        "INSERT INTO recipes (raw_url, raw_text, status) VALUES (?,?,?)",
        (req.url, req.text, "pending"),
    )
    recipe_id = cur.lastrowid
    db.commit()
    db.close()

    bg.add_task(_process_recipe, recipe_id, req.url, req.text)

    return {"recipe_id": recipe_id, "status": "processing"}
