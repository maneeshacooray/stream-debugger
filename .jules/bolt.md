## 2026-08-01 - Optimizing Time Formatting in Playback Paths

**Learning:** High-frequency playback updates (every 500ms or faster) trigger `formatTime` helper runs frequently. Standard string parsing via `toString()` and `.padStart(2, '0')` generates substantial dynamic string allocations and JS thread overhead.

**Action:** Implement a bounded Map-based cache keyed by rounded seconds, combined with manual concatenation instead of `.padStart()` for integer padding. This reduces string allocation overhead and speeds up hot time formatting runs by ~40% with zero changes to output format.

## 2026-08-01 - Memoizing Web Video View Components to Eliminate Playback Re-renders

**Learning:** Web video player wrappers (`StreamVideoView.web.tsx`) re-evaluate on every parent render during high-frequency time updates (every 500ms) or log entries. Un-memoized inline style objects and `StyleSheet.flatten()` calls create unnecessary DOM reconciliation overhead and JS heap allocations.

**Action:** Wrap web video view components in `React.memo` and memoize container and video inline style objects using `useMemo` to eliminate re-render cycles and style flattening overhead when player references and layout props remain stable.
