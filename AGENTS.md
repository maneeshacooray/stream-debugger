# AGENTS.md

Context for AI coding agents (e.g. Jules) working in this repo.

## Project

Stream Debugger — an Expo / React Native app for debugging HLS stream playback: segment inspection, real-time bitrate/buffering metrics, and playlist (master/media) metadata analysis. Targets Android, iOS, and Web from a single codebase via `expo-router` and `expo-video`.

## Commands

- Install deps: `npm ci` (use `npm install` only when adding/updating a dependency)
- Lint: `npm run lint`
- Start dev server: `npm start`
- Run on web: `npm run web`
- Run on Android: `npm run android`
- Run on iOS: `npm run ios`

There is no test suite yet — rely on `npm run lint` and TypeScript (`strict` mode is on) to catch issues before opening a PR.

## Layout

- `app/` — `expo-router` file-based routes (typed routes enabled).
- `components/` — shared UI; `components/ui/` for lower-level primitives.
- `hooks/` — shared hooks, including `.web.ts` platform overrides.
- `config/streams.ts` — sample/test stream URLs used by the app.
- `constants/` — theme and static content.

## Conventions

- TypeScript strict mode; use the `@/*` path alias (maps to repo root) instead of relative `../../` imports.
- Follow the existing `eslint-config-expo` rules (`eslint.config.js`) — run `npm run lint` before finishing a task.
- Component filenames are kebab-case (`themed-text.tsx`) except a few PascalCase exceptions (`DeviceStats.tsx`, `StreamMetadata.tsx`, `NetworkQualityIndicator.tsx`); match the existing file's casing when editing it, default to kebab-case for new files.
- This is a UI-heavy app: when changing rendering/layout code, check behavior on both web and native if possible (or call it out in the PR description).

## CI

`.github/workflows/release.yml` builds and releases on push to `main` (Android APK via EAS). It skips on doc/markdown-only changes. Don't bump `package.json` version unless intentionally cutting a release — see the comment at the top of that workflow.
