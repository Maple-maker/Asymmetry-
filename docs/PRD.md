# Product Requirements Document: Asymmetry MVP

**Version:** 1.0 — Draft
**Status:** Ready for Technical Design
**Last Updated:** 2026-06-07

---

## Product Overview

**App Name:** Asymmetry
**Tagline:** Turn your doomscrolling into doing.
**One-liner:** A second brain that captures what you save online and turns it into connections, reminders, and action — instead of a graveyard.
**Launch Goal:** Personal daily use, then 100 active public users within 60 days of release

---

## The Problem

You've saved 3,000 Instagram posts. You've bookmarked 800 tweets. You told yourself you'd come back to each one and actually *do something* with it.

You haven't.

The asymmetry: saving something takes 1 tap. Actually using it takes opening a different app, scrolling through an unsorted list, re-reading context you've forgotten, deciding what to do with it, and somehow remembering to follow through. Nobody does that.

**Existing solutions fall short:**
- **Instagram Saves / Twitter Bookmarks:** Just a list. No search, no tags, no reminders, no AI, no cross-platform.
- **Pocket / Instapaper:** URL-only, no social post support, no AI connections, still a graveyard.
- **Readwise:** Powerful but complex, primarily for highlights/books, expensive.
- **Notion:** Requires manual setup and maintenance — the opposite of frictionless.
- **Mymind:** Closest competitor, but no social post focus, no action item extraction.

**The gap:** No app captures social saves + multi-modal content + AI-powered action extraction in one simple mobile experience.

---

## Who It's For

### Primary Persona: The Chronic Saver

**Who they are:**
- 25–40 years old, heavy Instagram and Twitter/X user
- Saves content with genuine intention ("I'll make this recipe", "I want to read more about this")
- Self-improvement or creativity oriented — they *want* to use their saves
- Tech-comfortable but not a developer

**Their daily frustration:**
- Opens Instagram saves and feels overwhelmed — 3,000 posts, no order
- Forgets why they saved something 2 weeks ago
- Bookmarks articles and never returns to them
- Takes screenshots of ideas but loses them in camera roll
- Records voice memos to self and never listens back

**What they need:**
- Zero-friction capture (one tap from wherever they are)
- AI to do the work of making sense of it all
- Surface the right thing at the right time
- Turn "saved for later" into "acted on"

### User Story
"Meet Alex. Alex has 2,847 Instagram saves. Every Sunday, Alex opens them up planning to cook from those recipes, read those articles, reach out to those accounts. Twenty minutes later, Alex has scrolled through 40 posts, saved 6 more, and done nothing. With Asymmetry, when Alex saves a recipe from Instagram, it's captured, tagged as 'cooking > Italian', linked to three other recipes Alex saved, and a reminder pops up Thursday: *'You said you'd try this one.'* Alex made the pasta."

---

## MVP Features

### Must Have for Launch (P0)

#### 1. Universal Capture via Share Sheet
- **What:** iOS Share Extension that appears in the share menu of ANY app (Instagram, Twitter, Safari, YouTube, Notes, Voice Memos)
- **What it captures:**
  - URL shared from Instagram, Twitter, YouTube, or any browser → fetch metadata (title, image, description)
  - Screenshot/image → store + AI describes what's in it
  - Text → store + auto-tag
  - Voice memo → record in-app OR accept shared audio file
- **User story:** As a user scrolling Instagram, I want to tap Share → Asymmetry and have the post instantly captured so I never have to manually type anything.
- **Success criteria:**
  - Share appears in iOS share sheet for URLs, images, and text
  - URL posts are auto-enriched with title, preview image, and description within 5 seconds
  - Capture works without opening the main app

#### 2. Smart Vault
- **What:** The main library of everything captured — searchable, filterable, sorted
- **What's in each item:**
  - Preview image or thumbnail
  - AI-generated summary (1-2 sentences)
  - Auto-tags (topics detected by AI)
  - Source platform indicator (Instagram, Twitter, Web, Voice, etc.)
  - Date captured
  - Action items extracted (if any)
- **Search:** Both keyword and semantic ("find me things related to starting a business")
- **Filters:** By type (social post, article, image, voice), by tag, by date, by action status
- **User story:** As a user, I want to open the app and immediately see everything I've saved, search by topic, and filter by what still needs action.
- **Success criteria:**
  - All captured items visible in chronological list
  - Semantic search returns relevant results (not just keyword matches)
  - Filter by type works correctly
  - Each item shows its AI summary and tags

#### 3. AI Action Extraction
- **What:** When content is captured, AI automatically identifies and extracts any actionable items
- **Examples:**
  - Instagram reel about a recipe → Action: "Make the pasta carbonara"
  - Tweet about a book recommendation → Action: "Read 'X' by Author Y"
  - Screenshot of a workout → Action: "Try this ab circuit workout"
  - Article about productivity hack → Action: "Try the 2-minute rule this week"
- **User story:** As a user, I want AI to tell me what I should actually *do* with the things I save, so I don't have to re-read everything to figure it out.
- **Success criteria:**
  - 80%+ of saved content has at least one AI-suggested action item
  - Action items are specific, not generic ("make this recipe" not "do something with food content")
  - Users can dismiss, edit, or complete action items

#### 4. Connections View
- **What:** For any saved item, see other things you've saved that are semantically related
- **Displayed as:** "Related to this" section on item detail view (3-5 related items)
- **How it works:** pgvector cosine similarity on content embeddings
- **User story:** As a user viewing a saved Instagram post about minimalism, I want to see the three other things I've saved that connect to it, so I can build knowledge instead of isolated saves.
- **Success criteria:**
  - Every item shows at least 3 related items (once vault has 20+ entries)
  - Related items are genuinely thematically connected, not random
  - Tapping a related item opens it

#### 5. Action Items Dashboard
- **What:** A simple view of all pending action items extracted from saved content, with reminders
- **What it shows:**
  - List of all pending action items across all saved content
  - Which item they came from (tap to see source)
  - Status: pending / done / snoozed
  - Optional: set a reminder date/time
- **User story:** As a user, I want a single place to see everything I told myself I'd do, so I can actually follow through.
- **Success criteria:**
  - All pending actions visible in one list
  - Marking an action done removes it from the list
  - Snoozing reschedules the reminder
  - Reminders fire as iOS push notifications

---

### Nice to Have (P1 — If Time Allows)

- **Smart Resurfacing:** Push notification that resurfaces a saved item ("You saved this 14 days ago. Still relevant?")
- **Daily Digest:** Morning notification: "3 things you saved that you haven't acted on yet"
- **Voice Capture from Main App:** In-app record button (not just via share sheet)
- **Collections:** User-created folders to group related saves manually
- **Onboarding Walkthrough:** Tutorial showing how to use the share extension

---

### NOT in MVP (Saving for Later)

| Feature | Why We're Waiting |
|---------|------------------|
| Web app | Mobile is where saves happen — desktop is v2 |
| Android | iOS is faster to build share extension — Android next |
| Browser extension | Adds engineering complexity — share sheet covers the use case |
| Obsidian / Notion export | Useful but not urgent for MVP validation |
| Team / shared vaults | Personal use first, collaboration is a v2 business feature |
| Public profile / sharing | Out of scope for personal productivity MVP |
| Auto-pull Instagram saves | Instagram API doesn't allow this — share sheet is the workaround |
| Monetization / paywall | Validate value first, charge later |

---

## The Instagram / Twitter Problem (Acknowledged)

Instagram and Twitter do not provide API access to a user's saved posts or bookmarks for third-party apps. This is a hard platform limitation.

**Our solution:** The iOS Share Extension.

When a user is in Instagram looking at a saved post and wants to capture it:
1. Tap the share icon on the post
2. Tap "Asymmetry" in the share sheet
3. Done — captured, processed, in the vault within seconds

This is one extra tap vs. zero taps. That's the acceptable trade-off. The value Asymmetry provides (AI processing, connections, action items) justifies that extra tap. No competitor solves this perfectly — we solve it as well as technically possible without violating platform terms.

---

## How We'll Know It's Working

### Personal Use Metrics (First 30 Days)
| Metric | Target |
|--------|--------|
| Items captured per week | 20+ |
| Action items completed per week | 3+ |
| Daily opens of the app | 1+ |
| Vault size after 30 days | 100+ items |

### Public Launch Metrics (First 60 Days After Release)
| Metric | Target |
|--------|--------|
| App Store downloads | 500 |
| Users with 10+ items captured | 100 |
| D7 retention | 30% |
| Action items marked complete | 200 total across all users |

---

## Look & Feel

**Design Vibe:** Dark, focused, calm. Like Obsidian meets Notion meets a premium journaling app. Not colorful or gamified — serious but beautiful.

**Visual Principles:**
1. **Frictionless first:** Every interaction should feel like one fewer step than expected
2. **Information density without overwhelm:** Show a lot, but never feel cluttered
3. **AI is invisible:** The AI does its work in the background — users see results, not process

**Key Screens:**
1. **Inbox / Capture Confirmation** — Appears when you share something in. Shows what was captured, the AI summary, tags, and action items extracted. Quick review before dismissing.
2. **Vault** — Full library. List/grid toggle. Search bar. Filter chips. Each card shows preview + summary + tags.
3. **Item Detail** — Full view of one saved item. Shows source content, AI summary, action items, and "Related" section.
4. **Actions Dashboard** — All pending action items. Checklist. Tap to see source. Set reminder.
5. **Settings** — Notification preferences, connected accounts, data management.

---

## Technical Constraints

**Platform:** iOS first
**Responsive:** N/A (native mobile)
**Performance:**
- Share extension capture: < 3 seconds from tap to confirmed
- Vault load: < 1 second
- Search results: < 2 seconds (semantic search)

**Privacy:**
- All content is private to the user by default
- No sharing of content to third parties except AI processing APIs
- Users should be aware their content is processed by AI (disclosed in onboarding + privacy policy)

**Offline:**
- Content should be viewable offline (cached)
- Capture queue should work offline and sync when connected

**Scalability:**
- MVP: single user (personal use)
- Public: handle 1,000 users on Supabase free tier → paid tier at growth

---

## Budget & Constraints

**Development tools:** Free (Expo, Supabase free tier, Claude Code)
**AI processing:** ~$0.001–0.005 per item captured (Claude Haiku — negligible at MVP scale)
**Monthly operating (personal use):** $0 on free tiers
**Monthly operating (100 public users):** ~$5–15 (minor AI API costs, Supabase stays free)
**Timeline:** 3-4 weeks to personal TestFlight → 2 months to App Store

---

## Open Questions

- What happens when a user shares a private Instagram post URL? (The URL may not be scrapeable — we fall back to asking the user for a screenshot)
- Does Apple's App Review allow share extensions that process content through external AI APIs? (Likely yes, requires privacy disclosure)
- What's the minimum vault size before semantic connections become useful? (Hypothesis: 20+ items)
- Should action items be mandatory (always extracted) or opt-in per item?

---

## Definition of Done for MVP

The MVP is ready for personal TestFlight use when:
- [ ] Share extension installs and appears in iOS share sheet
- [ ] URL sharing from Instagram captures metadata + AI summary + tags + action items
- [ ] Vault displays all captured items, searchable
- [ ] Connections view shows related items
- [ ] Actions dashboard lists all pending action items
- [ ] Push notifications fire for reminders
- [ ] App works offline for viewing (captures queue when offline)
- [ ] One complete end-to-end flow works: share → capture → view → complete action

---

*Status: Ready for Technical Design (Part 3)*
*Next: Create TECH-DESIGN.md and AGENTS.md*
