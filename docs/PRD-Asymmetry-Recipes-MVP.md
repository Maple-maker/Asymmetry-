# Product Requirements Document: Asymmetry (Recipes) MVP

**Tagline:** *Never lose a recipe you saved — and actually cook it.*
**Status:** Draft — niche locked to recipes
**Date:** 2026-06-08
**North Star:** **Cook Rate** = % of saved recipes cooked within 30 days
**Parent doc:** see `Asymmetry-MVP-Plan.md` for the full concept, research, and the broader (multi-type) vision this narrows down from.

-----

## 1. Overview

|                     |                                                                                                                                                                                                                                                                      |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Product**          |Asymmetry — recipe edition                                                                                                                                                                                                                                            |
|**Problem**          |You save recipe Reels/TikToks/Shorts/articles with every intention of cooking them. You never come back. The save was intent; the meal never happened.                                                                                                                |
|**MVP goal**         |Close the loop on food: save a recipe → it becomes a usable recipe + a shopping list + a reminder → you cook it → it’s logged. Prove **Cook Rate ≥ 30%** in a personal/closed beta.                                                                                   |
|**Why recipes first**|Recipes are the most *actionable* save: clear structure (ingredients + steps), an obvious deploy action (cook it), and two killer utilities competitors underuse — a consolidated **shopping list** and **reminders**. Smallest surface area to prove the deploy loop.|
|**Target launch**    |4–6 weeks to a working personal MVP (recipes is narrower than the general app).                                                                                                                                                                                       |

## 2. Target user

**Primary — “Saves recipes, cooks few of them.”** Busy, likes to cook, follows food creators, has 50–500 saved food posts across apps and a camera roll of recipe screenshots. Wants weeknight dinners sorted without the saved stuff going to waste.

**Jobs to be done:**

1. *Functional:* “Turn that recipe I just saw into something I can shop for and cook this week.”
1. *Emotional:* “Stop feeling like all my saves are wasted.”
1. *Social (later):* “Share my go-to weeknight deck with a friend.”

*(Persona zero is you — build for your own saved-recipe pile first.)*

## 3. User journey

1. **Capture** — See a recipe Reel → **Share → Asymmetry** (Stage 0: run an iOS Shortcut). Or paste a link / drop a screenshot.
1. **Parse** — Asymmetry pulls **ingredients (with quantities), steps, time, servings, source** from the caption / transcript / OCR. Shows a clean recipe card. *Aha:* “It read the Reel and gave me the ingredient list.”
1. **Plan** — Pick a few recipes for the week → tap **Build shopping list**. Ingredients merge across recipes, group by aisle, checkable.
1. **Remind** — Set **cook** (“Thursday 6pm”), **prep/defrost** (“take chicken out tonight”), or **shop** (“Saturday 10am”) reminders.
1. **Cook & log** — Cook from the steps view → tap **Cooked it**. Cook Rate ticks up.
1. **Re-engage** — Weekly “**Cook 3**” nudge surfaces recipes you saved but haven’t made.

## 4. MVP features (Must-have, P0)

### 1. Recipe capture

- **What:** Share-sheet target (Stage 1) / iOS Shortcut → API (Stage 0) / paste link / screenshot import.
- **Success criteria:**
  - [ ] Save a recipe from a link or screenshot in ≤ 2 taps.
  - [ ] Raw item is stored immediately, before parsing.
  - [ ] Item appears in the library within ~5s (parse can finish async).

### 2. Recipe parse → structured

- **What:** LLM extracts `title`, `ingredients[{qty, unit, item, prep}]`, `steps[]`, `total_time`, `servings`, `source_url`. Inputs: caption + YouTube transcript where available + OCR of screenshots. All fields editable.
- **Success criteria:**
  - [ ] ≥ 80% of test recipes parse ingredients + steps without manual fixing.
  - [ ] Missing/garbled fields are clearly flagged and editable, never silently wrong.
  - [ ] A recipe with no extractable data still saves as raw (link + thumbnail + note).

### 3. Recipe library

- **What:** Auto-organized list of saved recipes; search; recipe detail (ingredients + steps + source). Light auto-tags (e.g., quick / vegetarian / high-protein) optional.
- **Success criteria:**
  - [ ] New saves appear automatically; searchable by name/ingredient.
  - [ ] Detail view shows ingredients, steps, time, servings, and a link back to source.

### 4. Shopping list builder ⭐

- **What:** Select one or more recipes → generate a **consolidated** shopping list. Merge identical `item + unit` (sum quantities), list mismatched units separately, group by **aisle/category** (produce, dairy, meat, pantry, frozen, other). Check items off; add manual items; clear/checked state persists.
- **User value:** This is the single most-used action — it turns “saved recipe” into “I can actually go shop.”
- **Success criteria:**
  - [ ] Selecting 2+ recipes produces one merged list with summed quantities for matching items.
  - [ ] Items grouped by category; each is checkable; state persists.
  - [ ] User can add/remove items manually.

### 5. Reminders ⭐

- **What:** Set reminders tied to a recipe or list:
  - **Cook reminder** (“Cook Lemon Chicken — Thu 6pm”)
  - **Prep/defrost reminder** (“Take chicken out — tonight 9pm”)
  - **Shop reminder** (“Shop this list — Sat 10am”)
  - MVP: device-local notifications. (Optional fast-follow: write to OS Reminders/Calendar.)
- **User value:** Reminders are what move a saved recipe from “someday” to a specific moment — the deploy trigger.
- **Success criteria:**
  - [ ] User can attach a cook/prep/shop reminder to any recipe or list.
  - [ ] Reminder fires as a notification at the set time.

### 6. Cooked tracking (the North Star)

- **What:** Mark a recipe **Cooked** (optional quick rating/note). Show **Cook Rate** and a simple “cooked this month” count.
- **Success criteria:**
  - [ ] Any recipe can be marked cooked, with timestamp.
  - [ ] A 30-day Cook Rate is visible on the home screen.

## 5. NOT in MVP (saving for later)

|Feature                                     |Why wait                                 |Planned |
|--------------------------------------------|-----------------------------------------|--------|
|Servings auto-scaling                       |Nice, not core to the loop               |v1.1    |
|Meal-plan calendar (assign recipes to days) |After shopping + reminders land          |v2      |
|Pantry tracking (“already have it”)         |Adds friction; validate basics first     |v2      |
|Store integration / price / delivery handoff|Partnerships, not proof                  |v2+     |
|Nutrition / macros                          |Different job                            |v2      |
|Voice “cook mode” (hands-free steps)        |Polish                                   |v2      |
|Sharing recipe decks                        |Distribution play                        |v2      |
|Other content types (workouts, code, places)|Only after recipes proves the deploy loop|post-MVP|

## 6. Success metrics

|Category      |Metric                                             |Target (beta)     |Measure          |
|--------------|---------------------------------------------------|------------------|-----------------|
|**North Star**|30-day Cook Rate                                   |≥ 30%             |cooked / saved   |
|Activation    |Saves ≥3 recipes + builds 1 shopping list in week 1|60%               |events           |
|Engagement    |Weekly “Cook 3” → ≥1 cooked                        |40%               |nudge→cook events|
|Utility       |Shopping lists generated / user / week             |≥ 1               |events           |
|Quality       |Ingredient/step parse accuracy                     |≥ 80% un-corrected|manual-edit rate |

## 7. UI/UX direction

- **Vibe:** Warm, fast, appetizing — calmer than a feed. (Lighter than your AEGIS command-center look; this is a consumer cooking app. JetBrains-Mono-for-numbers is fine for the cook-rate stat, but the recipe content should feel inviting.)
- **Key screens:**
1. **Home / “Cook 3”** — this week’s surfaced recipes + Cook Rate + recent saves.
1. **Library** — all saved recipes, searchable.
1. **Recipe detail** — ingredients, steps, time, servings, source, [Build list] [Remind] [Cooked it].
1. **Shopping list** — merged, aisle-grouped, checkable.
1. **Capture confirmation** — “here’s the recipe I pulled out” moment.
- **Principles:** capture is sacred · every recipe has an obvious next action · celebrate cooking, not collecting.

## 8. Technical considerations (summary)

- **Platform:** mobile-first; Stage 0 validated via iOS Shortcut + web view (see `TechDesign`).
- **Parsing:** LLM → structured JSON; the hard part is **ingredient normalization** for list merging — MVP rule: merge on identical `(item, unit)`, sum quantities; keep mismatched units as separate lines; map item → aisle via LLM/lookup.
- **Reminders:** Stage 1 via Expo local notifications; optional OS Reminders/Calendar write later.
- **Privacy:** personal-only; user can delete everything; Markdown/Obsidian export of recipes + lists.
- **Resilience:** never lose a save — raw stored before parse; failed parse = editable stub.

## 9. Risks

|Risk                                 |Impact|Mitigation                                                                                    |
|-------------------------------------|------|----------------------------------------------------------------------------------------------|
|Becomes another graveyard            |High  |Cook Rate as North Star; “Cook 3” + reminders are the loop-closers, not extras.               |
|Caption/transcript too thin to parse |Med   |OCR screenshots; let user edit; save raw regardless.                                          |
|Ingredient merge gets messy (units)  |Med   |Keep merge rule simple; show un-merged items honestly rather than guessing wrong.             |
|Crowded (Sorti et al. do recipes too)|Med   |Win on the **deploy loop** — shopping list + reminders + cook tracking, not “we save recipes.”|

## 10. Definition of Done (MVP)

- [ ] Save a recipe (link or screenshot) → structured recipe appears.
- [ ] Library lists + searches recipes; detail shows ingredients/steps.
- [ ] Build a merged, aisle-grouped, checkable shopping list from ≥2 recipes.
- [ ] Set a cook/prep/shop reminder that fires.
- [ ] Mark cooked → Cook Rate visible.
- [ ] Failed parse never loses the save.
- [ ] Delete-all + Markdown export work.
- [ ] One full loop works end-to-end: save → list → remind → cook → logged.

## 11. Next steps

1. Commit this file as `docs/PRD-Asymmetry-Recipes-MVP.md` and `HANDOFF.md` to branch `claude/second-brain-app-plan-e8tQQ`.
1. Point Claude Code at them; have it propose a Stage 0 plan and wait for approval.
1. Build the Stage 0 vertical slice in the order listed in `HANDOFF.md`.