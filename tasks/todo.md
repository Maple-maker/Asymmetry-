# Asymmetry — UI overhaul codebase port

> Mockups approved 2026-06-23 (`../mockups/`). This is the implementation log.
> Branch: `feat/ui-darkmode` (off `main`).

## Architecture decision (the linchpin)

**NativeWind v4 `darkMode: 'class'` + CSS-variable token swap + a theme-aware Icon map.**

Why: the app already uses semantic tokens everywhere (`text-ink`, `bg-bg-surface`,
`border-line`, `bg-brand`…). Map those tokens to CSS variables in `global.css`,
define Daylight under `:root` and Nightfall under `.dark`, and every semantic
class adapts to dark mode automatically — **zero per-screen className churn.**

The remaining hardcoded hex lives in (a) `Icon` `color` props (244 instances) and
(b) inline `style` backgrounds (~75). (a) is solved centrally by making `Icon`
translate its incoming light-hex to the dark-hex via a map → 244 call sites
untouched. (b) is a mechanical follow-up codemod (slice 2).

Confirmed via NativeWind v4 docs: `useColorScheme().setColorScheme()` (from
`nativewind`) flips the `dark` class when `darkMode:'class'`; `null` follows OS.

## Slice 1 — Dark mode foundation (ship + verify)

- [x] Branch `feat/ui-darkmode`
- [ ] `tailwind.config.js` — `darkMode:'class'`; map semantic colors → `rgb(var(--token))`
- [ ] `src/global.css` — `:root` Daylight vars + `.dark` Nightfall vars
- [ ] `src/store` + `types.ts` — `themeMode: 'light'|'dark'|'auto'`, persisted
- [ ] `src/lib/theme.ts` — `useThemeColor`, resolved-scheme hook, `LIGHT→DARK` icon map
- [ ] `src/components/Icon.tsx` — auto-translate light hex → dark hex when dark
- [ ] `src/app/_layout.tsx` — color-scheme provider from store; theme-aware bg + StatusBar
- [ ] `src/app/settings.tsx` — Appearance group: Light / Dark / Auto picker
- [ ] Shell inline-`#F3F5F1`/`#FFFFFF` backgrounds → themed (root, tabs, settings, home)
- [ ] Verify: `npx tsc --noEmit` + Metro bundle compiles
- [ ] Commit

## Slice 2 — Long-tail polish (follow-up)

- [ ] Codemod remaining inline `backgroundColor` hexes across screens → themed
- [ ] Audit any literal-hex text colors / gradients for dark contrast
- [ ] Visual QA each screen in both themes

## Slice 3 — Mockup-driven redesigns (separate slices)

- [ ] Home → number-is-hero balance card + two-number story
- [ ] Holding scorecard → transparent three-layer rubric + visual audit bar
- [ ] Radar → unified holdings row + signal feed
