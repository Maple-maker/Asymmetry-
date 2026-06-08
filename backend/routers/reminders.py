from fastapi import APIRouter, HTTPException
from models import ReminderCreateRequest
from database import get_db

router = APIRouter(prefix="/api")


@router.post("/reminders", status_code=201)
async def create_reminder(req: ReminderCreateRequest):
    if req.type not in ("cook", "prep", "shop"):
        raise HTTPException(400, "type must be cook, prep, or shop")
    if not req.recipe_id and not req.list_id:
        raise HTTPException(400, "Provide recipe_id or list_id")

    db = get_db()
    cur = db.execute(
        """INSERT INTO reminders (recipe_id, list_id, type, remind_at, note)
           VALUES (?,?,?,?,?)""",
        (req.recipe_id, req.list_id, req.type, req.remind_at, req.note),
    )
    reminder_id = cur.lastrowid
    db.commit()
    db.close()
    return {"reminder_id": reminder_id}


@router.get("/reminders")
async def list_reminders(fired: bool = False):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM reminders WHERE fired=? ORDER BY remind_at", (int(fired),)
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: int):
    db = get_db()
    db.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
    db.commit()
    db.close()
    return {"ok": True}
