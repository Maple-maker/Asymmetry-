from pydantic import BaseModel, HttpUrl
from typing import Optional


class IngestRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None


class IngredientParsed(BaseModel):
    qty: Optional[float] = None
    unit: Optional[str] = None
    item: str
    prep: Optional[str] = None
    aisle: str = "other"


class RecipeParsed(BaseModel):
    title: Optional[str] = None
    total_time_minutes: Optional[int] = None
    servings: Optional[int] = None
    source_platform: str = "other"
    ingredients: list[IngredientParsed] = []
    steps: list[str] = []


class ShoppingListBuildRequest(BaseModel):
    recipe_ids: list[int]
    name: Optional[str] = None


class ReminderCreateRequest(BaseModel):
    type: str
    remind_at: str
    recipe_id: Optional[int] = None
    list_id: Optional[int] = None
    note: Optional[str] = None


class CookLogRequest(BaseModel):
    recipe_id: int
    rating: Optional[int] = None
    note: Optional[str] = None
