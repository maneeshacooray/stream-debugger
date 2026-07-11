## 2026-06-24 - Redundant upstream state updates

**Learning:** Found a performance bottleneck where a child component (`NetworkQualityIndicator`) was frequently reporting data via a callback (`onStatsUpdate`) to the main screen state, but this state was never consumed. This triggered a secondary re-render of the entire main component tree every 500ms (on every video time update) for no functional benefit.

**Action:** Before implementing or maintaining "upstream" state reporting (child-to-parent), verify that the parent actually consumes that state. Remove unused state setters from callbacks to prevent redundant re-render cycles in high-frequency update paths.

## 2026-06-26 - Root re-renders from high-frequency video stats

**Learning:** Discovered that keeping video playback stats (currentTime, bitrate, etc.) in the root component state caused the entire application tree—including large logs lists and multi-view grids—to re-render every 500ms. This is extremely expensive in React Native as the list items and UI components grow.

**Action:** Isolate high-frequency state updates into dedicated, memoized sub-components. By moving video stats and their listeners into a separate `InfoTabContent` component, root-level re-renders are eliminated during playback, significantly reducing JS thread load and improving UI responsiveness.

## 2026-06-28 - Throttling high-frequency state updates

**Learning:** Even when high-frequency state is isolated in a sub-component, triggering a re-render every 500ms (standard for video time updates) can still be costly if the component performs expensive calculations or object allocations. React's reconciliation still runs, and many objects are recreated.

**Action:** Implement a bail-out strategy in high-frequency listeners (like `timeUpdate`). Skip state updates if fast-changing values (like `currentTime`) have changed by less than a threshold (e.g., 100ms) and metadata (tracks, status) remains unchanged. Memoize secondary computations (like codec parsing) that depend on this state.

## 2026-06-30 - Optimizing style allocations in high-frequency lists

**Learning:** `LogEntryItem` was allocating style objects for background colors (levels and categories) inside every instance, even when memoized. In high-frequency log paths, this creates significant garbage collection pressure. React Native's `StyleSheet` is optimized for static style objects.

**Action:** Pre-calculate all theme-aware style variants (like log levels and categories) within the central `createStyles` function. Child components can then consume these via stable keys (e.g., `styles[\`logLevel_\${log.level}\`]`), eliminating per-render or per-instance object creation and reducing memory churn.

## 2026-07-02 - High-frequency logging bottlenecks

**Learning:** Found that `toLocaleTimeString` is extremely expensive in high-frequency update paths (like log streams) due to locale-aware processing. Additionally, performing array operations like `slice(-100)` directly in the render block or IIFEs creates unnecessary allocations and CPU overhead on every render cycle.

**Action:** Replace `toLocaleTimeString` with manual string formatting for timestamps in hot paths. Memoize the visible slice of lists (using `useMemo`) before rendering to maintain reference stability and reduce garbage collection pressure.

## 2026-07-04 - Root re-renders from URL input typing

**Learning:** Holding the `inputUrl` state in the root component caused every keystroke to re-render the entire application, including the video player and large log lists. This creates noticeable lag on low-end devices. Wrapping callbacks in `useCallback` is essential when passing them to memoized children to prevent breaking `React.memo`.

**Action:** Isolate text input state into dedicated memoized components. Use the `key` prop to reset internal state when parent dependencies change. Always memoize parent callbacks to ensure referential stability for child component props. Re-use existing sub-object references in state updates unless metadata actually changes to minimize GC pressure.

## 2026-07-06 - Intermediate array allocations in manifest parsing

**Learning:** Processing large HLS manifests using chains like `.split().map().filter()` creates multiple intermediate arrays, leading to significant memory pressure and garbage collection overhead, especially in a React Native environment where JS thread performance is critical.

**Action:** Refactor text parsing logic to use a single-pass loop. Split the content only once and handle trimming, empty lines, and validation within the main iteration to minimize object allocations and CPU cycles.

## 2026-07-06 - Redundant re-parsing in tab-based navigation

**Learning:** Components in different tabs (e.g., 'Info' and 'Playlist') often need the same parsed data. Switching between them causes the component to unmount and remount, losing local state and triggering expensive re-fetching and re-parsing of manifests.

**Action:** Implement a module-level cache (e.g., a `Map`) with a Time-To-Live (TTL) and maximum size limit. This allows fast data retrieval across component lifecycles while preventing memory leaks and ensuring data freshness.

## 2026-07-08 - Combined single-pass processing for log stats and filtering

**Learning:** Calculating statistics (total, levels) and filtering logs in separate passes over the same array leads to redundant iterations. In high-frequency update scenarios (every 500ms), this adds unnecessary CPU overhead and memory churn from intermediate array allocations.

**Action:** Combine simultaneous array processing tasks (like stats calculation and filtering) into a single-pass for...of loop within a memoized block. This reduces the number of traversals and object allocations, improving performance in hot paths.

## 2026-07-10 - Redundant re-render on mount via useEffect

**Learning:** Found that initializing state to null and updating it in useEffect on mount caused a redundant re-render cycle and UI flicker. This was particularly visible in DeviceStats where info is available synchronously via Platform and Dimensions APIs.

**Action:** Use lazy state initialization useState(() => getInitialValue()) for any metadata available synchronously at mount. This ensures the first render is correct and complete, eliminating the second render pass and reducing JS thread load.

## 2026-07-10 - Unused state properties in high-frequency paths

**Learning:** Discovered that keeping unused properties (like 'timestamp' in PerformanceMetrics) in state objects updated by intervals causes unnecessary object allocations and triggers React reconciliation for no benefit.

**Action:** Prune state objects to only include properties consumed by the UI. In high-frequency update paths, use a bail-out strategy in setMetrics(prev => ...) to return the existing reference if values haven't changed, preventing redundant re-renders.
