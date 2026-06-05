# No Fomo — Agent Brief

You are building **No Fomo**, a native iOS app that delivers asymmetric investment intelligence before the crowd finds it. The premise: an AI council scans government contracts, FDA approvals, earnings transcripts, partnerships, and insider trading 24/7 — debates every opportunity — and surfaces only what passes a 75/100 conviction threshold. Users get the BLUF, the bull and bear case, and buy zones. Never late again.

This document is the single source of truth for all agents (Claude Code, DeepSeek, OpenCode). Read it before touching any file.

---

## Stack

| Layer | Tech |
|---|---|
| iOS app | SwiftUI, iOS 17+, Swift 5.9 |
| Backend / DB | Supabase (PostgreSQL + Edge Functions) |
| Auth | Sign in with Apple + email/password via Supabase Auth |
| Real-time feed | Supabase REST API → `opportunity_feed` table |
| Push notifications | APNs via Supabase `push_tokens` table |
| AI pipeline | Supabase Edge Functions (Deno/TypeScript) |
| Radar engine | `maple-maker/Asymmetry-` repo (separate — do not modify here) |

**Supabase project:** `jmtkygwvmrolfvwueggs`
**Supabase URL:** `https://jmtkygwvmrolfvwueggs.supabase.co`
**Anon key:** stored in `NoFomo/Services/SupabaseService.swift` as `SUPABASE_ANON_KEY` — replace the placeholder before building.

---

## Repo structure

```
NoFomo/                          ← Xcode project root
  NoFomo/
    NoFomoApp.swift              ← @main entry point
    Components/
      DesignSystem.swift         ← ALL colors, fonts, spacing — DS enum
      ScoreGauge.swift           ← Circular score arc + DimensionBar + ProbabilityBadge
    Models/
      Opportunity.swift          ← Core data model + FinancialSnapshot + Verdict + mock data
      User.swift                 ← AppUser + SubscriptionTier
    Services/
      AuthService.swift          ← Sign in with Apple, email/password, session persistence
      SupabaseService.swift      ← fetchFeed, fetchWatchlist, registerPushToken
    ViewModels/
      FeedViewModel.swift        ← Feed state, pagination, watchlist toggle, filter logic
    Views/
      MainTabView.swift          ← Tab bar: Feed / Watchlist / Settings
      Feed/
        FeedView.swift           ← Main radar feed, filter chips, pull-to-refresh
        OpportunityCard.swift    ← Feed card: tier badge, BLUF, metrics, council row, buy zones
      Detail/
        OpportunityDetailView.swift  ← Full brief: hero, score row, expandable sections
        CouncilDebateView.swift      ← Gemini / DeepSeek / CIO council + bull/bear cases
        FinancialsView.swift         ← 2-col metrics grid with color highlights
        BuyZoneView.swift            ← Price ladder, zone cards, risk/reward ratio
        SourceView.swift             ← Signal chain + original quote + vault report link
      Onboarding/
        OnboardingView.swift     ← 4-page carousel + Sign in with Apple + email auth
      Settings/
        SettingsView.swift       ← Subscription card, alert toggles, sign out
      Watchlist/
        WatchlistView.swift      ← Bookmarked positions + WatchlistRow
```

---

## Design system — never deviate from this

All design tokens live in `DS` enum in `DesignSystem.swift`. **Do not hardcode any color, font, or spacing value outside of this file.**

### Colors

```swift
DS.Color.background     // #0A0A0F  — near-black, main bg
DS.Color.card           // #12121A  — card surface
DS.Color.cardElevated   // #1A1A25  — metrics strips, inputs
DS.Color.border         // #2A2A35  — subtle dividers

DS.Color.bull           // #00FF88  — green: positive, upside, BULL verdict
DS.Color.bear           // #FF3B5C  — red: negative, downside, BEAR verdict
DS.Color.neutral        // #FFB800  — amber: neutral, watch

DS.Color.tier1          // #FFD700  — gold: Tier 1 Exceptional (use sparingly)
DS.Color.tier2          // #00BFFF  — electric blue: Tier 2 High Conviction
DS.Color.accent         // #7B61FF  — purple: AI/intelligence elements

DS.Color.textPrimary    // white
DS.Color.textSecondary  // #888888
DS.Color.textMuted      // #555566
```

### Typography

```swift
DS.Font.displayBold(size)    // headlines, tickers, scores
DS.Font.displayMedium(size)  // CTAs, section titles
DS.Font.mono(size)           // ALL financial numbers — prices, percentages, scores
DS.Font.body(size)           // body copy, descriptions (default 15pt)
DS.Font.caption(size)        // labels, metadata (default 12pt)
```

**Rule: every financial number uses `DS.Font.mono()`** — prices, scores, percentages, market caps. No exceptions.

### Spacing

```swift
DS.radiusCard    // 16  — cards
DS.radiusSmall   // 8   — inner elements
DS.paddingCard   // 16  — card internal padding
DS.paddingScreen // 20  — screen edge padding
```

---

## Data model — key fields

`Opportunity` maps 1:1 to the `opportunity_feed` Supabase table.

```swift
ticker          // "IREN"
companyName     // "Iris Energy Limited"
tier            // 1 | 2 | 3
overallScore    // 0-100 Double
bluf            // Bottom Line Up Front — the one-sentence thesis
debateVerdict   // .bull | .bear | .neutral  (CIO synthesis)
geminiVerdict   // Gemini's verdict
deepseekVerdict // DeepSeek's verdict
probabilityScore // 0-95 Double — catalyst probability
marketMiss      // What the market is getting wrong
invalidationTrigger // Exact condition that breaks the thesis
buyZoneAggressive / buyZoneBase / buyZoneConservative
targetPrice / floorPrice / upsidePct / downsidePct
isTripleSignal  // true when market cap + catalyst + insider buying all align
snap            // FinancialSnapshot: price, mktCap, pe, evToEbitda, grossMarginTTM, etc.
isPremium       // true for Tier 1 or score ≥ 85 — buy zones paywalled for free tier
```

---

## Subscription tiers

| Tier | Price | Access |
|---|---|---|
| Free | $0 | 1 alert/day, 24h delayed, buy zones locked |
| Pro | $9.99/mo | Unlimited real-time, all buy zones |
| Annual | $79.99/yr | Same as Pro, 33% saving |

**Paywall rule:** `opportunity.isPremium && !user.subscriptionTier.hasFull` → blur buy zones, show lock overlay. Never hide the BLUF, tier, or score — only the buy zones.

---

## Supabase tables (read-only from app)

| Table | Purpose |
|---|---|
| `opportunity_feed` | Main read model — all surfaced opportunities |
| `user_watchlist` | User-bookmarked tickers |
| `push_tokens` | APNs token registration |

**RLS:** `opportunity_feed` is publicly readable for non-premium rows. Premium rows require authenticated session. Watchlist and push_tokens require `auth.uid()` match.

---

## Key UI patterns — follow these exactly

**Cards float:** background `DS.Color.card`, border `0.5pt` at tier color `.opacity(0.3)`, corner radius `DS.radiusCard`.

**Score gauge:** circular arc, tier color, animates on appear in 600ms with spring.

**⚡ Triple Signal badge:** gold capsule with bolt icon — only shown when `opportunity.isTripleSignal == true`. This is rare. It should feel like a classified alert.

**Verdict chips:** small capsules — color at 10-20% opacity fill, full color text + icon. `BULL` / `BEAR` / `NEUTRAL`. Never longer than 7 chars.

**Buy zone paywall:** blur radius 6 + `.ultraThinMaterial` overlay with lock icon. Never `redacted()` — the blurred numbers stay visible under the blur.

**Expandable sections in detail view:** one section open at a time, spring animation 300ms, chevron rotates.

**Numbers:** always mono font, always formatted to appropriate decimal places. Prices: `%.2f`. Percentages: `Int`. Scores: `Int`. Market caps: formatted to `$XB` / `$XM`.

---

## What's built — current status

- [x] Design system (`DS` enum — colors, fonts, spacing)
- [x] `ScoreGauge`, `DimensionBar`, `ProbabilityBadge` components
- [x] `Opportunity` + `FinancialSnapshot` models (maps to Supabase schema)
- [x] `AppUser` + `SubscriptionTier` model
- [x] `AuthService` — Sign in with Apple + email/password + session persistence
- [x] `SupabaseService` — feed fetch, watchlist CRUD, push token registration
- [x] `FeedViewModel` — pagination, filter logic, watchlist toggle
- [x] `FeedView` — full feed with filter chips, pull-to-refresh, pagination
- [x] `OpportunityCard` — tier badge, ⚡ Triple Signal badge, BLUF, metrics strip, council row, buy zone paywall
- [x] `OpportunityDetailView` — hero, score row, probability bar, expandable sections
- [x] `CouncilDebateView` — Gemini / DeepSeek / CIO council, bull/bear cases, invalidation trigger
- [x] `FinancialsView` — 2-col metrics grid
- [x] `BuyZoneView` — price ladder, zone cards, risk/reward ratio, range slider
- [x] `SourceView` — signal chain, original quote, vault report link
- [x] `BearCaseView` — bear case + exit condition
- [x] `OnboardingView` — 4-page carousel + auth (Apple + email)
- [x] `MainTabView` — Feed / Watchlist / Settings tabs
- [x] `WatchlistView` + `WatchlistRow`
- [x] `SettingsView` — subscription card, alert toggles

## What's next — priority order

- [ ] **Xcode project file** — `.xcodeproj` or `Package.swift` — the Swift files exist but need a project wrapper to build
- [ ] **APNs push notification handler** — register token on launch, handle foreground/background
- [ ] **StoreKit 2 integration** — Pro and Annual subscription products
- [ ] **Paywall sheet** — full-screen upgrade prompt triggered by locked buy zones
- [ ] **Real-time feed updates** — Supabase Realtime subscription for live opportunity inserts
- [ ] **Onboarding → deep link** — if user taps a push notification before auth, route correctly after sign-in
- [ ] **Empty states** — "Radar scanning..." animation when feed is empty
- [ ] **Error states** — network failure handling with retry
- [ ] **iPad layout** — sidebar navigation for iPad

---

## Multi-agent workflow

This repo is designed to work across three agents simultaneously. Each agent reads this file on session start.

### Claude Code (claude.ai/code)
Primary development agent. Handles: feature implementation, bug fixes, Supabase schema changes, Swift code. Has access to this repo and `maple-maker/Asymmetry-` (the radar engine).

### DeepSeek
Best for: architecture decisions, algorithm design, code review, complex logic. Feed it the relevant file + this CLAUDE.md section + the specific question. Push its output to a branch, open a PR, let Claude Code review and merge.

### OpenCode
Runs in your local terminal. Same repo. `git pull` before starting, `git push` when done. Use for: local Xcode builds, simulator testing, anything that requires running the actual app.

### From your phone
Open a GitHub Issue with your idea. Use these labels:
- `feature` — new capability
- `bug` — something broken
- `design` — visual change
- `radar` — change to the AI pipeline (goes to Asymmetry- repo)

Agents pick up labeled issues and implement. Every commit references the issue number.

---

## Coding conventions

- **No hardcoded colors, fonts, or spacing** — always use `DS.*`
- **No comments explaining what code does** — only comment WHY when non-obvious
- **No force unwraps** in production code — use `guard`, `if let`, or `??`
- **ViewModels are `@MainActor final class`** with `@Published` properties
- **Services are singletons** — `static let shared = ServiceName()`
- **All network calls are `async throws`**
- **Preview data** uses `Opportunity.mock` — keep mock current with model changes
- **File naming** — one type per file, file name matches type name exactly
- **Branch naming** — `feature/short-description`, `fix/short-description`

---

## Do not

- Do not modify anything in the `Asymmetry-` / radar engine repo from this session
- Do not add third-party dependencies without discussion — the app currently has zero dependencies (pure SwiftUI + URLSession)
- Do not store API keys or secrets in source code — use Xcode build settings or `.xcconfig` files excluded from git
- Do not push directly to `main` — use feature branches and PRs
- Do not add `@State` to a `View` for data that lives longer than the view — use `@StateObject` / `@EnvironmentObject`
