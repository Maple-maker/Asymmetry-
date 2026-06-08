# Asymmetry — Handoff & Sync Note

**Updated:** 2026-06-08
**Planning thread:** Claude.ai (product/spec/research)
**Build thread:** Claude Code — branch `claude/second-brain-app-plan-e8tQQ`

-----

## Why this file exists

Two separate Claude sessions are working on Asymmetry. **They do not share live memory** — nothing in the planning chat reaches the Claude Code branch automatically, and vice versa. This file is the bridge. Commit it to the repo, have Claude Code read it at the start of each session, and update it whenever a decision changes.

**To sync Claude Code, paste this to it:**

> “Read `HANDOFF.md` and `docs/PRD-Asymmetry-Recipes-MVP.md`. Summarize the MVP scope and the Stage 0 build order back to me before writing any code.”

## Lanes (so we don’t overlap)

|Lane                                            |Owner          |Lives in                                                                                      |
|------------------------------------------------|---------------|----------------------------------------------------------------------------------------------|
|Product, spec, research, decisions, copy        |Planning thread|`docs/PRD-*.md`, `docs/research-*.md`, `docs/TechDesign-*.md`, this file                      |
|Implementation: code, schema, tests, scaffolding|Claude Code    |`src/`, `AGENTS.md` execution                                                                 |
|**Rule**                                        |—              |Any code decision that changes product scope gets written back into the PRD **and** this file.|

-----

## Canonical decisions (source of truth)

- **App:** Asymmetry. **MVP niche is locked to RECIPES.** No other content types until the recipe loop is proven.
- **North Star:** **Cook Rate** — % of saved recipes cooked within 30 days. *Not* “recipes saved.”
- **Capture:** Share-sheet-forward. **No bulk import** of existing IG/TikTok/X saves (no personal API / against ToS). Stage 0 capture = **iOS Shortcut → API**.
- **Two headline actionable features (the wedge):**
1. **Auto shopping list** built from the recipe’s content — merged across recipes, grouped by aisle, checkable.
1. **Reminders** — cook / prep-or-defrost / shop reminders.
- **Stage 0 stack:** iOS Shortcut → **Python FastAPI** → **Supabase** (Postgres + `pgvector` + Auth + Storage) → simple **web view**.
- **Stage 1 (after loop is proven):** Expo / React Native app + share extension.
- **AI:** cheap model for classify, stronger model for extraction (Haiku-class / Sonnet-class — refer to families, not pinned versions).
- **Privacy:** personal-life only (no work/CUI ever), user can view/delete all data, first-class Markdown/Obsidian export.

## Stage 0 build order (for Claude Code)

Build the thinnest vertical slice that closes the loop. Save raw item **before** any AI runs — a parse failure must never lose a save.

1. **DB schema** — `recipes`, `ingredients`, `steps`, `shopping_lists`, `shopping_list_items`, `reminders`, `cook_log`.
1. **Ingest endpoint** — accepts a shared URL / pasted text / screenshot; stores raw immediately; enqueues parse.
1. **Recipe parse job** — LLM → structured JSON (title, ingredients[qty, unit, item, prep], steps[], time, servings, source). Degrade gracefully; fields editable.
1. **Web view** — recipe list + recipe detail (ingredients + steps).
1. **Shopping list builder** — select recipes → merged, aisle-grouped, checkable list; manual add.
1. **Reminders** — cook / prep / shop; scaffold local notifications (Stage 1) or calendar write.
1. **Cooked tracking** — “Cooked it” toggle → cook-rate display.

## Out of scope right now

Non-recipe content types · full video/visual understanding · social/sharing · meal-plan calendar · pantry tracking · nutrition · price/store integration · servings auto-scaling (v2 candidate).

## Open questions to resolve together

- How deep to go on **ingredient unit normalization** for list merging (MVP: merge identical `item + unit`; list mismatched units separately).
- **Servings scaling** in MVP or v2?
- Reminders via **local notifications** vs writing to the OS **Reminders/Calendar**.