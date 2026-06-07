# Asymmetry

> Turn your doomscrolling into doing.

A second brain mobile app that captures your saved Instagram posts, Twitter bookmarks, screenshots, voice memos, links, and notes — and uses AI to extract connections, action items, and reminders from them.

Because the asymmetry between saving something (1 tap) and actually using it (overwhelming) is the whole problem.

---

## The Problem

You have 3,000 Instagram saves. You've looked at maybe 12 of them.

The content graveyard grows. Every bookmark, every "I'll come back to this", every screenshot — gone forever in a list you never scroll back through.

Asymmetry closes the gap: capture anything via the iOS share sheet, let AI do the heavy lifting (tags, summaries, action items, connections), and surface what matters when it matters.

---

## Core Features (MVP)

- **Universal Capture** — iOS Share Extension works from any app: Instagram, Twitter, Safari, YouTube, Notes
- **AI Processing** — Auto-tags, summarizes, and extracts action items from everything you save
- **Smart Vault** — Searchable library (keyword + semantic) with filter by type, tag, and status
- **Connections** — See what else you've saved that relates to what you're looking at
- **Actions Dashboard** — All the things you told yourself you'd do, in one list, with reminders

---

## Stack

| Layer | Tech |
|-------|------|
| Mobile | Expo (React Native) + Expo Router |
| Backend | Supabase (Postgres + pgvector + Auth + Storage + Edge Functions) |
| AI | Claude claude-haiku-4-5 (Anthropic) |
| Transcription | OpenAI Whisper |

---

## Planning Docs

- [`docs/DEEP-RESEARCH-PROMPT.md`](docs/DEEP-RESEARCH-PROMPT.md) — Research prompt (run this in Claude/Gemini before building)
- [`docs/PRD.md`](docs/PRD.md) — Product Requirements Document
- [`docs/TECH-DESIGN.md`](docs/TECH-DESIGN.md) — Technical Architecture & Design
- [`AGENTS.md`](AGENTS.md) — AI coding assistant instructions

---

## Status

Planning complete. Starting Phase 1: Foundation (Expo + Supabase + Share Extension).
