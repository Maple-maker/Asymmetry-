# Deep Research Prompt — Asymmetry

> Copy this entire prompt into Claude, Gemini, or ChatGPT (with web search enabled for best results).
> Save the output as `RESEARCH-RESULTS.md` before moving to the PRD.

---

## Deep Research Request: Asymmetry — Second Brain for Social Savers

<context>
I'm building a mobile app called Asymmetry as a non-technical founder using AI to write the code.

The core problem: People (including me) save thousands of posts on Instagram and bookmark hundreds on Twitter/X with the genuine intention of doing something with them — but never do. The same is true for YouTube videos, articles, voice memos to self, screenshots, and random notes. The content graveyard grows. The asymmetry between how easy it is to save something (one tap) vs. actually using it (overwhelming) is the entire problem.

Asymmetry closes that gap by:
1. Capturing any saved content through a mobile share sheet (so it works with Instagram, Twitter, Safari, etc.)
2. Using AI to auto-tag it, summarize it, extract action items, and find connections to other things you've saved
3. Surfacing content as reminders and actionable steps — not just a prettier graveyard

Target user: Chronic savers. People who save everything and act on nothing. Heavy social media users (25-40 yo) who are self-improvement or creativity oriented. Think: the person who has 3,000 Instagram saves and has looked at maybe 12 of them.

Platform: iOS first (iPhone), Android later
Budget: Near-zero — needs to use free tiers wherever possible
Timeline: MVP in 3-4 weeks using AI-assisted coding with Expo and Supabase
</context>

<instructions>

### Key Questions to Answer:

**1. Competitors & Alternatives**
- What apps exist that try to solve the "saved content" problem? (Readwise, Pocket, Instapaper, Notion, Matter, Raindrop.io, Mymind, etc.)
- What do users love and hate about each? (Pull real reviews if you can)
- What does Asymmetry need to do better than all of them?
- Are any of these specifically targeting the Instagram saves / Twitter bookmarks problem?

**2. The Instagram & Twitter API Problem (Critical)**
- What are the current API limitations for accessing Instagram saves and Twitter/X bookmarks programmatically?
- What workarounds exist? (Share sheet, browser extension, manual URL paste, etc.)
- How do competitors handle this? Do any successfully pull in Instagram saves automatically?
- What is realistically possible for a solo indie developer with no enterprise API access?

**3. Mobile Tech Stack (Expo + Supabase)**
- Is Expo the right choice for a content-capture mobile app with a share extension?
- How complex is building an iOS Share Extension with Expo?
- Can you use Expo with native iOS modules for the share extension?
- Supabase free tier — is it sufficient for an MVP (storage for images, DB for content, auth)?
- What are the biggest pitfalls when building this type of app with this stack?

**4. AI Integration — Cheapest Viable Approach**
- What is the most cost-effective way to add these AI features on a zero/near-zero budget:
  a. Auto-tagging content by topic
  b. Summarizing a URL or image
  c. Extracting action items from text
  d. Finding semantic connections between saved items (vector search)
  e. Transcribing voice memos
- Compare: Claude claude-haiku-4-5, GPT-4o-mini, Gemini Flash, Mistral — cost per 1000 calls for each of these tasks
- Is pgvector (inside Supabase free tier) viable for semantic similarity search at MVP scale?
- What are free or near-free embedding options?

**5. Content Ingestion Architecture**
- For a URL shared from Instagram (e.g., a reel): what metadata can you extract from the URL? (og:image, og:description, etc.)
- For a screenshot: what AI vision approach gives the best result for understanding the screenshot content?
- For a voice memo: what is the cheapest/best transcription option on mobile?
- What does the iOS share extension actually receive when a user shares from Instagram vs. Twitter vs. Safari?

**6. Monetization (for future reference)**
- How do similar personal productivity apps monetize? (Freemium, subscription, one-time purchase)
- What price point works for this category? What features are typically behind a paywall?
- What does a realistic revenue trajectory look like for this type of utility app?

### Research Focus:
- Prioritize practical, actionable findings over theoretical
- Include specific free tier limits with numbers (not vague "generous free tier")
- Pull real user reviews for competitor apps — quote specific complaints
- Flag anything that might be a hard technical blocker for a non-technical founder
- Current state as of 2025-2026

### Required Deliverables:
1. **Competitor Matrix** — App name, key features, pricing, what users hate, what users love
2. **Instagram/Twitter Workaround Report** — What's actually possible for an indie dev
3. **Tech Stack Verdict** — Expo + Supabase: go or no-go, with specific gotchas
4. **AI Cost Calculator** — Estimated cost per 100 users/month for each AI operation
5. **Differentiation Opportunities** — Where the gap is in the market
</instructions>

<output_format>
- Plain English explanations — I'm not a developer
- Tables for comparisons
- Include URLs and source dates for major claims
- Flag conflicting information between sources
- Be honest about what's hard, not just what's theoretically possible
- Bold the most important findings
</output_format>
