from fastapi import APIRouter, HTTPException
from models import CookLogRequest
from database import get_db

router = APIRouter(prefix="/api")


@router.post("/cook", status_code=201)
async def log_cooked(req: CookLogRequest):
    db = get_db()
    recipe = db.execute("SELECT id FROM recipes WHERE id=?", (req.recipe_id,)).fetchone()
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    cur = db.execute(
        "INSERT INTO cook_log (recipe_id, rating, note) VALUES (?,?,?)",
        (req.recipe_id, req.rating, req.note),
    )
    log_id = cur.lastrowid
    db.commit()
    db.close()
    return {"log_id": log_id}


@router.delete("/cook/{recipe_id}/last")
async def undo_cook(recipe_id: int):
    """Remove the most recent cook log entry for a recipe."""
    db = get_db()
    row = db.execute(
        "SELECT id FROM cook_log WHERE recipe_id=? ORDER BY cooked_at DESC LIMIT 1",
        (recipe_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "No cook log for this recipe")
    db.execute("DELETE FROM cook_log WHERE id=?", (row["id"],))
    db.commit()
    db.close()
    return {"ok": True}


@router.get("/stats")
async def stats():
    db = get_db()
    saved_30 = db.execute(
        "SELECT COUNT(*) FROM recipes WHERE created_at >= datetime('now','-30 days') AND status='ready'"
    ).fetchone()[0]
    cooked_30 = db.execute(
        "SELECT COUNT(DISTINCT recipe_id) FROM cook_log WHERE cooked_at >= datetime('now','-30 days')"
    ).fetchone()[0]
    total_saved = db.execute("SELECT COUNT(*) FROM recipes WHERE status='ready'").fetchone()[0]
    total_cooked = db.execute("SELECT COUNT(DISTINCT recipe_id) FROM cook_log").fetchone()[0]
    db.close()

    return {
        "cook_rate_30d": round((cooked_30 / saved_30 * 100) if saved_30 else 0),
        "cooked_30d": cooked_30,
        "saved_30d": saved_30,
        "total_saved": total_saved,
        "total_cooked": total_cooked,
    }
