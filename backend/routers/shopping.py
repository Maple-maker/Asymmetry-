from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from collections import defaultdict
from models import ShoppingListBuildRequest
from database import get_db
from tmpl import render

router = APIRouter()

AISLE_ORDER = ["produce", "meat", "dairy", "frozen", "pantry", "other"]


def _merge_ingredients(ingredients: list[dict]) -> list[dict]:
    """
    Merge ingredients across recipes.
    Merge rule: identical (item_normalized, unit) → sum qty.
    Mismatched units for the same item → keep as separate lines.
    """
    # key: (item_lower, unit_lower_or_none)
    merged: dict[tuple, dict] = {}

    for ing in ingredients:
        item_key = ing["item"].lower().strip()
        unit_key = (ing["unit"] or "").lower().strip() or None
        key = (item_key, unit_key)

        if key in merged:
            existing = merged[key]
            if ing["qty"] is not None and existing["qty"] is not None:
                existing["qty"] += ing["qty"]
                existing["qty_display"] = _fmt_qty(existing["qty"], unit_key)
            # If either qty is None, leave display as-is
        else:
            merged[key] = {
                "item": ing["item"],
                "qty": ing["qty"],
                "unit": ing["unit"],
                "aisle": ing["aisle"] or "other",
                "qty_display": _fmt_qty(ing["qty"], unit_key),
            }

    return list(merged.values())


def _fmt_qty(qty: float | None, unit: str | None) -> str:
    if qty is None:
        return ""
    # Convert to fraction-friendly display
    whole = int(qty)
    frac = qty - whole
    frac_map = {0.25: "¼", 0.5: "½", 0.75: "¾", 0.33: "⅓", 0.67: "⅔"}
    closest = min(frac_map, key=lambda f: abs(frac - f))
    if abs(frac - closest) < 0.05:
        display = (f"{whole} " if whole else "") + frac_map[closest]
    elif whole:
        display = str(whole)
    else:
        display = str(qty)
    return display.strip()


@router.get("/shopping", response_class=HTMLResponse)
async def shopping_page(request: Request, add: list[int] = []):
    db = get_db()
    lists = db.execute(
        "SELECT * FROM shopping_lists ORDER BY created_at DESC LIMIT 20"
    ).fetchall()
    ready_recipes = db.execute(
        "SELECT id, title FROM recipes WHERE status='ready' ORDER BY created_at DESC"
    ).fetchall()
    db.close()
    return render(
        "shopping.html",
        active_page="shopping",
        lists=[dict(l) for l in lists],
        ready_recipes=[dict(r) for r in ready_recipes],
        preselect_ids=[str(i) for i in add],
    )


@router.post("/api/shopping/build")
async def build_list(req: ShoppingListBuildRequest):
    if not req.recipe_ids:
        raise HTTPException(400, "No recipe IDs provided")

    db = get_db()

    # Verify all recipes exist and are ready
    placeholders = ",".join("?" * len(req.recipe_ids))
    recipes = db.execute(
        f"SELECT id, title FROM recipes WHERE id IN ({placeholders}) AND status='ready'",
        req.recipe_ids,
    ).fetchall()
    if len(recipes) != len(req.recipe_ids):
        raise HTTPException(400, "One or more recipes not found or not ready")

    # Create list
    name = req.name or ", ".join(r["title"] or f"Recipe {r['id']}" for r in recipes)
    cur = db.execute("INSERT INTO shopping_lists (name) VALUES (?)", (name,))
    list_id = cur.lastrowid

    # Link recipes
    for rid in req.recipe_ids:
        db.execute(
            "INSERT INTO shopping_list_recipes (list_id, recipe_id) VALUES (?,?)",
            (list_id, rid),
        )

    # Fetch all ingredients
    raw_ingredients = db.execute(
        f"SELECT * FROM ingredients WHERE recipe_id IN ({placeholders})",
        req.recipe_ids,
    ).fetchall()

    merged = _merge_ingredients([dict(i) for i in raw_ingredients])

    for item in merged:
        db.execute(
            """INSERT INTO shopping_list_items (list_id, qty_display, unit, item, aisle)
               VALUES (?,?,?,?,?)""",
            (list_id, item["qty_display"], item["unit"], item["item"], item["aisle"]),
        )

    db.commit()
    db.close()
    return {"list_id": list_id}


@router.get("/shopping/{list_id}", response_class=HTMLResponse)
async def shopping_list_detail(request: Request, list_id: int):
    db = get_db()
    lst = db.execute("SELECT * FROM shopping_lists WHERE id=?", (list_id,)).fetchone()
    if not lst:
        raise HTTPException(404)

    items = db.execute(
        "SELECT * FROM shopping_list_items WHERE list_id=? ORDER BY aisle, item",
        (list_id,),
    ).fetchall()

    # Group by aisle
    by_aisle: dict[str, list] = defaultdict(list)
    for item in items:
        by_aisle[item["aisle"]].append(dict(item))

    ordered_aisles = [(a, by_aisle[a]) for a in AISLE_ORDER if a in by_aisle]

    db.close()
    return render(
        "shopping_list.html",
        active_page="shopping",
        lst=dict(lst),
        ordered_aisles=ordered_aisles,
    )


@router.post("/api/shopping/{list_id}/check/{item_id}")
async def toggle_check(list_id: int, item_id: int):
    db = get_db()
    row = db.execute(
        "SELECT checked FROM shopping_list_items WHERE id=? AND list_id=?",
        (item_id, list_id),
    ).fetchone()
    if not row:
        raise HTTPException(404)
    new_val = 0 if row["checked"] else 1
    db.execute(
        "UPDATE shopping_list_items SET checked=? WHERE id=?", (new_val, item_id)
    )
    db.commit()
    db.close()
    return {"checked": bool(new_val)}


@router.post("/api/shopping/{list_id}/add")
async def add_item(list_id: int, item: str, qty_display: str = "", unit: str = ""):
    db = get_db()
    lst = db.execute("SELECT id FROM shopping_lists WHERE id=?", (list_id,)).fetchone()
    if not lst:
        raise HTTPException(404)
    db.execute(
        """INSERT INTO shopping_list_items (list_id, qty_display, unit, item, aisle, is_manual)
           VALUES (?,?,?,?,?,1)""",
        (list_id, qty_display, unit, item, "other"),
    )
    db.commit()
    db.close()
    return {"ok": True}
