# Technical Design Document: Asymmetry MVP

**Version:** 1.0
**Status:** Draft
**Stack:** Expo (React Native) + Supabase + Claude AI
**Last Updated:** 2026-06-07

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         USER'S PHONE (iOS)              │
│                                         │
│   ┌──────────────────┐                  │
│   │  iOS Share Sheet │ ← Instagram,     │
│   │  Extension       │   Twitter, etc.  │
│   └────────┬─────────┘                  │
│            │                            │
│   ┌────────▼─────────┐                  │
│   │  Asymmetry App   │                  │
│   │  (Expo/RN)       │                  │
│   │  - Vault View    │                  │
│   │  - Actions View  │                  │
│   │  - Item Detail   │                  │
│   └────────┬─────────┘                  │
└────────────┼────────────────────────────┘
             │ HTTPS
┌────────────▼────────────────────────────┐
│         SUPABASE (Backend)              │
│                                         │
│   ┌──────────────┐  ┌────────────────┐  │
│   │  Postgres DB │  │ Storage Bucket │  │
│   │  + pgvector  │  │ (images/audio) │  │
│   └──────┬───────┘  └───────┬────────┘  │
│          │                  │           │
│   ┌──────▼──────────────────▼────────┐  │
│   │       Edge Functions             │  │
│   │  - process_capture()             │  │
│   │  - scrape_url()                  │  │
│   │  - generate_embedding()          │  │
│   └──────────────┬───────────────────┘  │
└─────────────────┼────────────────────── ┘
                  │
┌─────────────────▼───────────────────────┐
│         CLAUDE API (Anthropic)          │
│  claude-haiku-4-5 for:                  │
│  - Auto-tagging                         │
│  - Summarization                        │
│  - Action extraction                    │
│  - Image understanding (vision)         │
└─────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why | Cost |
|-------|------------|-----|------|
| Mobile Framework | Expo SDK 52 + Expo Router | Cross-platform, great DX, managed workflow | Free |
| Share Extension | Expo native module (react-native-share-menu or custom) | iOS share sheet integration | Free |
| Backend / DB | Supabase (Postgres) | Auth + DB + Storage + Edge Functions in one | Free tier |
| Vector Search | pgvector (built into Supabase) | Semantic similarity in same DB | Included in Supabase |
| AI / LLM | Claude claude-haiku-4-5 (Anthropic) | Cheapest capable model, great at extraction | ~$0.25/M tokens |
| Image Storage | Supabase Storage | Part of free tier | Free (1GB) |
| Auth | Supabase Auth | Built-in, supports Apple Sign In | Free |
| Push Notifications | Expo Notifications + APNs | Native iOS push | Free |
| Transcription | OpenAI Whisper API | Best-in-class, cheap | $0.006/min |

---

## Database Schema

```sql
-- users (handled by Supabase Auth)

-- All captured content lives here
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Content
  type TEXT NOT NULL CHECK (type IN ('url', 'image', 'voice', 'text', 'note')),
  raw_url TEXT,                     -- original URL if shared
  raw_text TEXT,                    -- raw text content if text share
  storage_path TEXT,                -- Supabase Storage path for images/audio

  -- AI-processed fields (populated by Edge Function after capture)
  title TEXT,
  description TEXT,
  preview_image_url TEXT,
  ai_summary TEXT,
  ai_tags TEXT[],
  source_platform TEXT CHECK (source_platform IN (
    'instagram', 'twitter', 'youtube', 'tiktok', 'web', 'voice', 'screenshot', 'other'
  )),

  -- Vector embedding for semantic search
  embedding VECTOR(1536),

  -- Processing state
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ
);

-- Action items extracted from saved content
CREATE TABLE action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  description TEXT NOT NULL,        -- "Make the pasta carbonara this weekend"
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'snoozed')),
  remind_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Index for fast similarity search
CREATE INDEX ON items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Row-level security (users can only see their own data)
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their items" ON items
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own their action items" ON action_items
  FOR ALL USING (auth.uid() = user_id);
```

---

## Key Components

### 1. iOS Share Extension

The most technically novel part of the app. When a user shares from Instagram:

```
Instagram → iOS Share Sheet → Asymmetry Share Extension
```

**What the share extension receives (from Instagram/Twitter):**
- A URL (e.g., `https://www.instagram.com/reel/abc123/`)
- Sometimes: plain text
- Sometimes: an image (if user long-presses and saves)

**Share Extension Flow:**
1. User taps Asymmetry in share sheet
2. Extension UI appears (small overlay, not full app launch)
3. Extension sends payload to Supabase via API call:
   ```json
   { "type": "url", "raw_url": "https://instagram.com/reel/abc123", "user_id": "..." }
   ```
4. Shows "Captured!" confirmation
5. Supabase Edge Function processes asynchronously

**Implementation:** Use `react-native-share-menu` or Expo's `expo-share-intent` package, combined with a native iOS app group for data sharing between extension and main app.

---

### 2. Content Processing Pipeline (Supabase Edge Function)

Triggered when a new item is inserted into `items` table:

```
Insert Item (status: 'pending')
    ↓
Edge Function: process_capture()
    ↓
If type = 'url':
    → scrape_url() → fetch og:title, og:image, og:description
    → detect_platform() → instagram | twitter | youtube | other
    → fetch full page text if possible
    ↓
If type = 'image':
    → upload to Supabase Storage
    → claude_vision() → describe image content
    ↓
If type = 'voice':
    → upload to Supabase Storage
    → whisper_transcribe() → get text transcript
    ↓
All types:
    → claude_process(content_text):
        - Generate ai_summary (2-3 sentences)
        - Generate ai_tags (array of topic tags)
        - Extract action_items (array of specific actionable steps)
        - Detect source_platform
    → generate_embedding(ai_summary + title + tags)
    → Store embedding in items.embedding
    → Update status to 'ready'
    → Insert action_items rows
```

**Claude prompt for processing:**
```
You are processing a saved piece of content for a second brain app.

Content:
Title: {title}
URL: {url}
Description: {description}
Full Text: {text}

Respond in JSON:
{
  "summary": "2-3 sentence plain English summary of what this is",
  "tags": ["tag1", "tag2", "tag3"],  // 3-7 topic tags, lowercase
  "source_platform": "instagram|twitter|youtube|web|other",
  "action_items": [
    "Specific action the user might want to take based on this content"
  ]  // 0-3 items, only if genuinely actionable, empty array if not
}
```

---

### 3. Semantic Search & Connections

**How connections work:**
1. Each item has a 1536-dimension embedding vector stored in pgvector
2. When viewing an item, query for the 5 most similar items:

```sql
SELECT id, title, ai_summary, ai_tags,
  1 - (embedding <=> '[embedding_vector]') AS similarity
FROM items
WHERE user_id = $user_id
  AND id != $current_item_id
  AND status = 'ready'
ORDER BY embedding <=> '[embedding_vector]'
LIMIT 5;
```

**Semantic keyword search:**
```sql
-- Generate embedding for search query via Edge Function, then:
SELECT id, title, ai_summary, ai_tags, preview_image_url
FROM items
WHERE user_id = $user_id
  AND status = 'ready'
ORDER BY embedding <=> '[query_embedding]'
LIMIT 20;
```

---

### 4. App Screen Structure (Expo Router)

```
app/
├── (auth)/
│   ├── sign-in.tsx
│   └── sign-up.tsx
├── (app)/
│   ├── _layout.tsx          ← Tab navigator
│   ├── vault/
│   │   ├── index.tsx        ← Main vault list
│   │   └── [id].tsx         ← Item detail
│   ├── actions/
│   │   └── index.tsx        ← Action items dashboard
│   └── settings/
│       └── index.tsx
└── index.tsx                ← Redirect to auth or app
```

---

## MVP Development Phases

### Phase 1: Foundation (Days 1-7)
- [ ] Expo project setup with Expo Router
- [ ] Supabase project: schema, auth, RLS policies
- [ ] Basic auth flow (Sign in with Apple + Email)
- [ ] Vault screen: list items (empty state)
- [ ] Share extension: basic capture and POST to Supabase
- [ ] URL scraping Edge Function (no AI yet — just metadata)

**Deliverable:** Can share a URL from Safari, see it appear in vault

### Phase 2: AI Features (Days 7-14)
- [ ] Claude integration in Edge Function
- [ ] Auto-tagging, summarization, action extraction
- [ ] pgvector setup + embedding generation
- [ ] Item detail screen with AI summary + tags + actions
- [ ] Connections view (related items)
- [ ] Actions dashboard

**Deliverable:** Share Instagram URL → see AI summary + action items → see related items

### Phase 3: Polish + Launch (Days 14-21)
- [ ] Semantic search in vault
- [ ] Push notifications for action reminders
- [ ] Offline support (cached vault)
- [ ] Image capture (screenshot share)
- [ ] Voice capture (in-app record or file share)
- [ ] Onboarding
- [ ] App icon + splash screen
- [ ] TestFlight submission

**Deliverable:** Personal daily use on TestFlight

---

## Free Tier Analysis

| Service | Free Tier Limit | MVP Usage | Headroom |
|---------|----------------|-----------|----------|
| Supabase DB | 500MB | ~100MB for 1k items | Plenty |
| Supabase Storage | 1GB | ~500MB for images/audio | OK |
| Supabase Auth | 50,000 MAU | 1–100 users | Plenty |
| Supabase Edge Functions | 500k invocations/mo | ~10k for MVP | Plenty |
| Claude Haiku Input | Pay as you go | ~$0.25/1000 items | < $1/mo |
| Whisper API | Pay as you go | ~$0.006/min | < $1/mo |
| Expo EAS Build | 30 builds/mo (free) | ~5 builds/mo | OK |

**Estimated monthly cost at MVP scale (personal use):** $0–2/month

**At 100 active users (each capturing 50 items/month):** ~$5–15/month

---

## The Instagram/Twitter Constraint — Final Answer

**What's not possible:** Automatically pulling all of a user's Instagram saves or Twitter bookmarks without OAuth API access. Both platforms have locked this down or made it prohibitively expensive for indie devs.

**What is possible (and what we build):**
- iOS Share Extension appearing in Instagram's share menu
- User taps Share → Asymmetry → captured instantly
- URL is scraped for metadata (title, description, preview image)
- AI processes and enriches the content

**The honest UX tradeoff:** This requires one extra tap from the user vs. zero taps. It does NOT automatically import their existing 3,000 saves. A future v2 could offer a CSV import flow (Instagram allows data export via Settings) — this is a viable workaround to backfill the vault.

---

## Security & Privacy

- All data is stored per-user with Supabase RLS (row-level security)
- Content is only sent to Claude API for processing — Anthropic's terms apply (no training on API data by default)
- Users are informed in onboarding that content is processed by AI
- No content is shared with other users or third parties
- Audio is processed by OpenAI Whisper — brief mention in privacy policy
- No analytics beyond basic Supabase metrics in MVP

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Share extension complexity — Apple's native module is hard to build with Expo | High | High | Use `expo-share-intent` package; have fallback of manual URL paste in main app |
| Instagram URLs don't scrape well (JavaScript-rendered content) | High | Medium | Fall back to og: meta tags; show "paste screenshot instead" option |
| pgvector similarity not useful until 20+ items | Medium | Low | Show "Add more items to see connections" until threshold |
| Claude API costs more than expected | Low | Low | Cap processing to 500 chars for summaries, use Haiku (cheapest) |
| Apple App Review rejects share extension | Low | High | Follow Apple guidelines strictly; precedent exists for similar apps |

---

*Document status: Ready to build*
*Next step: Create AGENTS.md, then start Phase 1*
