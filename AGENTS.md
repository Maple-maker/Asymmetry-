# AGENTS.md — Asymmetry

> This file is the primary reference for any AI coding assistant working on this project.
> Read this before touching any code.

---

## What This App Does

**Asymmetry** is a second-brain mobile app that solves one specific problem: people save content on Instagram, Twitter, YouTube, and the web constantly — and never do anything with it.

The app captures saved content through an iOS Share Extension, processes it with AI (Claude claude-haiku-4-5), stores it in a Supabase database with semantic search (pgvector), and surfaces action items, connections between saves, and reminders — turning a content graveyard into something actually useful.

---

## Core User Flow (Never Break This)

```
User in Instagram → Taps Share → Taps "Asymmetry" in share sheet
    ↓
Share Extension captures URL/image/text
    ↓
Item inserted into Supabase DB (status: 'pending')
    ↓
Supabase Edge Function processes it:
  - Scrape URL metadata
  - Send to Claude for: summary, tags, action items
  - Generate embedding via OpenAI
  - Store embedding in pgvector
    ↓
Item status → 'ready'
    ↓
User opens app → sees item in vault with AI summary, tags, connections
    ↓
User sees action items → sets reminder → marks done
```

**The share extension is the entire product.** If it breaks, nothing else matters.

---

## Tech Stack

| What | Technology | Notes |
|------|------------|-------|
| Mobile | Expo SDK 52, Expo Router | Managed workflow |
| Share Extension | expo-share-intent or react-native-share-menu | iOS native module |
| Backend | Supabase | Free tier — don't add complexity that forces paid |
| Database | Postgres via Supabase | Schema in `supabase/migrations/` |
| Vector Search | pgvector (in Supabase) | `embedding VECTOR(1536)` column on items table |
| AI | Claude claude-haiku-4-5 (Anthropic) | Use Haiku, not Sonnet/Opus — cost |
| Image AI | Claude vision (claude-haiku-4-5) | For screenshot/image understanding |
| Transcription | OpenAI Whisper | Audio only |
| Embeddings | text-embedding-ada-002 (OpenAI) | Or Supabase's built-in |
| Auth | Supabase Auth | Apple Sign In + Email |
| Push Notifs | Expo Notifications + APNs | For action reminders |
| Storage | Supabase Storage | Images and audio files |

---

## Project Structure

```
Asymmetry/
├── app/                         ← Expo Router screens
│   ├── (auth)/
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (app)/
│   │   ├── _layout.tsx          ← Tab bar layout
│   │   ├── vault/
│   │   │   ├── index.tsx        ← Main vault (list of all items)
│   │   │   └── [id].tsx         ← Item detail + connections + actions
│   │   ├── actions/
│   │   │   └── index.tsx        ← All pending action items
│   │   └── settings/
│   │       └── index.tsx
│   └── index.tsx                ← Auth redirect
├── components/                  ← Shared UI components
├── lib/
│   ├── supabase.ts              ← Supabase client
│   └── types.ts                 ← TypeScript types from DB schema
├── supabase/
│   ├── migrations/              ← SQL migration files
│   └── functions/
│       └── process-capture/     ← Main AI processing Edge Function
│           └── index.ts
├── share-extension/             ← iOS Share Extension code
├── docs/                        ← PRD, Tech Design, Research Prompt
└── AGENTS.md                    ← This file
```

---

## Rules for This Codebase

### Always
- Use TypeScript. No `any` types.
- Use Supabase's generated types (`supabase gen types typescript`)
- Check Supabase free tier limits before adding new features that use storage/compute
- Keep the share extension as simple as possible — complex UI there is a mistake
- Process content asynchronously — never make the user wait for AI

### Never
- Call Claude Sonnet or Opus — use Haiku only (cost matters)
- Store secrets in the app — all API keys go in Supabase Edge Function env vars
- Add a feature that requires a paid Supabase plan for MVP
- Put business logic in the mobile app — it goes in Edge Functions
- Skip row-level security on any new table
- Fetch all items at once — always paginate (page size: 20)

### Database Rules
- Every new table must have `user_id UUID REFERENCES auth.users(id)` and RLS enabled
- Never delete data — use soft deletes (`deleted_at TIMESTAMPTZ`)
- Migrations go in `supabase/migrations/` as SQL files with timestamps
- Always run `supabase gen types typescript` after schema changes

---

## Environment Variables

```bash
# Mobile app (.env.local)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# Supabase Edge Functions (set via Supabase Dashboard → Project Settings → Edge Functions)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

Never commit real API keys. The `.env.local` file is in `.gitignore`.

---

## Key Technical Details

### Share Extension Behavior
- On iOS, the share extension is a separate binary that shares an App Group with the main app
- Use `expo-share-intent` for managed Expo setup
- The extension should do the minimum: accept the share, POST to Supabase, show confirmation
- Do NOT try to run the full app inside the extension — it will be rejected by Apple

### What Instagram/Twitter Actually Shares
- Instagram post URL: `https://www.instagram.com/p/ABC123/` or `/reel/`
- Twitter URL: `https://twitter.com/user/status/123456` or `https://x.com/...`
- These URLs may not scrape well (JavaScript-rendered) — fall back to og: meta tags
- If scraping fails, store the URL and show "Tap to add a screenshot" prompt

### Claude Prompt Template (process-capture Edge Function)
```typescript
const prompt = `
You are processing a saved piece of content for a personal second brain app.

Content type: ${type}
Title: ${title || 'unknown'}
URL: ${url || 'none'}
Text content: ${textContent.slice(0, 2000)} // cap at 2000 chars

Respond ONLY with valid JSON, no markdown:
{
  "summary": "2-3 sentence plain English summary",
  "tags": ["tag1", "tag2"],
  "source_platform": "instagram|twitter|youtube|web|other",
  "action_items": ["Specific action if applicable"]
}

Rules:
- summary: what this is, in plain language
- tags: 3-7 lowercase topic tags (e.g., "productivity", "recipe", "fitness")
- action_items: 0-3 items, only if genuinely actionable, empty array if not
- action_items must be specific ("Make this carbonara recipe" not "cook more")
`
```

### pgvector Similarity Query
```typescript
// Find 5 most similar items to a given item
const { data } = await supabase.rpc('match_items', {
  query_embedding: embedding,
  match_threshold: 0.7,
  match_count: 5,
  user_id: userId,
  exclude_id: currentItemId
})
```

Create this as a Postgres function in a migration.

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Planning | Complete | PRD and Tech Design done |
| Phase 1: Foundation | Not started | Expo setup, Supabase schema, basic share extension |
| Phase 2: AI Features | Not started | Claude integration, pgvector, connections |
| Phase 3: Polish | Not started | Search, notifications, offline, TestFlight |

---

## When You Start a New Task

1. Check `docs/PRD.md` — is this feature in MVP scope? If not, ask before building.
2. Check this file for the relevant tech stack choice.
3. Write the Supabase migration first, then the Edge Function, then the mobile screen.
4. Always test the share extension manually — automated tests can't fully cover it.
5. Keep the Supabase free tier in mind — check storage/compute implications.

---

## Helpful Commands

```bash
# Start the app
npx expo start

# Generate Supabase TypeScript types
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/types.ts

# Run Supabase locally (optional, for development)
npx supabase start

# Deploy Edge Functions
npx supabase functions deploy process-capture

# Build for TestFlight
eas build --platform ios --profile preview
```
