from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from database import get_db
from tmpl import render

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    db = get_db()
    recipes = db.execute(
        """SELECT r.*,
               (SELECT COUNT(*) FROM cook_log WHERE recipe_id = r.id) AS cook_count
           FROM recipes r
           ORDER BY r.created_at DESC
           LIMIT 50"""
    ).fetchall()

    # Cook Rate: cooked / saved (last 30 days)
    saved_30 = db.execute(
        "SELECT COUNT(*) FROM recipes WHERE created_at >= datetime('now','-30 days') AND status='ready'"
    ).fetchone()[0]
    cooked_30 = db.execute(
        "SELECT COUNT(DISTINCT recipe_id) FROM cook_log WHERE cooked_at >= datetime('now','-30 days')"
    ).fetchone()[0]
    cook_rate = round((cooked_30 / saved_30 * 100) if saved_30 else 0)

    # Surfaced: up to 3 ready recipes not yet cooked
    surfaced = db.execute(
        """SELECT * FROM recipes
           WHERE status='ready'
             AND id NOT IN (SELECT DISTINCT recipe_id FROM cook_log)
           ORDER BY created_at DESC
           LIMIT 3"""
    ).fetchall()

    db.close()
    return render(
        "index.html",
        active_page="library",
        recipes=[dict(r) for r in recipes],
        cook_rate=cook_rate,
        cooked_30=cooked_30,
        saved_30=saved_30,
        surfaced=[dict(r) for r in surfaced],
    )


@router.get("/recipes/{recipe_id}", response_class=HTMLResponse)
async def recipe_detail(request: Request, recipe_id: int):
    db = get_db()
    recipe = db.execute("SELECT * FROM recipes WHERE id=?", (recipe_id,)).fetchone()
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    ingredients = db.execute(
        "SELECT * FROM ingredients WHERE recipe_id=? ORDER BY aisle, id", (recipe_id,)
    ).fetchall()
    steps = db.execute(
        "SELECT * FROM steps WHERE recipe_id=? ORDER BY step_number", (recipe_id,)
    ).fetchall()
    cook_logs = db.execute(
        "SELECT * FROM cook_log WHERE recipe_id=? ORDER BY cooked_at DESC", (recipe_id,)
    ).fetchall()
    reminders = db.execute(
        "SELECT * FROM reminders WHERE recipe_id=? AND fired=0 ORDER BY remind_at", (recipe_id,)
    ).fetchall()
    db.close()

    return render(
        "recipe.html",
        active_page="library",
        recipe=dict(recipe),
        ingredients=[dict(i) for i in ingredients],
        steps=[dict(s) for s in steps],
        cook_logs=[dict(c) for c in cook_logs],
        reminders=[dict(r) for r in reminders],
    )


@router.get("/api/recipes")
async def list_recipes_api():
    db = get_db()
    rows = db.execute(
        "SELECT id, title, status, source_platform, thumbnail_url, created_at FROM recipes ORDER BY created_at DESC"
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


@router.get("/api/recipes/{recipe_id}/status")
async def recipe_status(recipe_id: int):
    db = get_db()
    row = db.execute("SELECT id, status, title, parse_error FROM recipes WHERE id=?", (recipe_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404)
    return dict(row)
