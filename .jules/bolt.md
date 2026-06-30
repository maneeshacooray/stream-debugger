## 2026-06-24 - Redundant upstream state updates

**Learning:** Found a performance bottleneck where a child component (`NetworkQualityIndicator`) was frequently reporting data via a callback (`onStatsUpdate`) to the main screen state, but this state was never consumed. This triggered a secondary re-render of the entire main component tree every 500ms (on every video time update) for no functional benefit.

**Action:** Before implementing or maintaining "upstream" state reporting (child-to-parent), verify that the parent actually consumes that state. Remove unused state setters from callbacks to prevent redundant re-render cycles in high-frequency update paths.

## 2026-06-26 - Root re-renders from high-frequency video stats

**Learning:** Discovered that keeping video playback stats (currentTime, bitrate, etc.) in the root component state caused the entire application tree—including large logs lists and multi-view grids—to re-render every 500ms. This is extremely expensive in React Native as the list items and UI components grow.

**Action:** Isolate high-frequency state updates into dedicated, memoized sub-components. By moving video stats and their listeners into a separate `InfoTabContent` component, root-level re-renders are eliminated during playback, significantly reducing JS thread load and improving UI responsiveness.

## 2026-06-28 - Throttling high-frequency state updates

**Learning:** Even when high-frequency state is isolated in a sub-component, triggering a re-render every 500ms (standard for video time updates) can still be costly if the component performs expensive calculations or object allocations. React's reconciliation still runs, and many objects are recreated.

**Action:** Implement a bail-out strategy in high-frequency listeners (like `timeUpdate`). Skip state updates if fast-changing values (like `currentTime`) have changed by less than a threshold (e.g., 100ms) and metadata (tracks, status) remains unchanged. Memoize secondary computations (like codec parsing) that depend on this state.
