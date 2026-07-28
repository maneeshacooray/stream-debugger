## 2026-06-24 - Redundant upstream state updates

**Learning:** Found a performance bottleneck where a child component (`NetworkQualityIndicator`) was frequently reporting data via a callback (`onStatsUpdate`) to the main screen state, but this state was never consumed. This triggered a secondary re-render of the entire main component tree every 500ms (on every video time update) for no functional benefit.

**Action:** Before implementing or maintaining "upstream" state reporting (child-to-parent), verify that the parent actually consumes that state. Remove unused state setters from callbacks to prevent redundant re-render cycles in high-frequency update paths.

## 2026-06-26 - Root re-renders from high-frequency video stats

**Learning:** Discovered that keeping video playback stats (currentTime, bitrate, etc.) in the root component state caused the entire application tree—including large logs lists and multi-view grids—to re-render every 500ms. This is extremely expensive in React Native as the list items and UI components grow.

**Action:** Isolate high-frequency state updates into dedicated, memoized sub-components. By moving video stats and their listeners into a separate `InfoTabContent` component, root-level re-renders are eliminated during playback, significantly reducing JS thread load and improving UI responsiveness.

## 2026-06-28 - Throttling high-frequency state updates

**Learning:** Even when high-frequency state is isolated in a sub-component, triggering a re-render every 500ms (standard for video time updates) can still be costly if the component performs expensive calculations or object allocations. React's reconciliation still runs, and many objects are recreated.

**Action:** Implement a bail-out strategy in high-frequency listeners (like `timeUpdate`). Skip state updates if fast-changing values (like `currentTime`) have changed by less than a threshold (e.g., 100ms) and metadata (tracks, status) remains unchanged. Memoize secondary computations (like codec parsing) that depend on this state.

## 2026-07-30 - Optimizing style allocations in high-frequency lists

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

## 2026-07-12 - Timer churn and sub-component isolation in high-frequency indicators

**Learning:** Found that `NetworkQualityIndicator` was re-rendering every 500ms due to parent state updates, even when quality was stable. Additionally, the stall reset timer was being cleared and rescheduled on every render regardless of state, causing unnecessary JS timer churn.

**Action:** Isolate visual status indicators into memoized sub-components to prevent redundant re-renders of complex UI (like signal bars) when input data is stable. Only manage reset timers (like stall resets) when there is actual state to reset (`count > 0`) to minimize background JS thread activity. Pre-calculate all theme/status variants in `StyleSheet` to eliminate object allocations in these hot paths.

## 2026-07-14 - Redundant grid allocations during window resizing

**Learning:** Found that memoizing the multi-view grid calculation based directly on window `width` and `isLandscape` caused redundant row array allocations on every pixel of window resize, even when the column count remained the same. Additionally, passing inline arrow functions to memoized child components in a loop breaks `React.memo` effectiveness.

**Action:** Extract breakpoint-derived values (like `multiViewCols`) into their own `useMemo` and use those as dependencies for downstream layout calculations. Refactor child components to accept the underlying data object and use a stable callback reference to ensure `React.memo` prevents unnecessary re-renders in large grids.

## 2026-07-16 - Isolated timer management in high-frequency effects

**Learning:** Managing a reset timer (like 30s stall recovery) inside an effect that depends on high-frequency props (like `currentTime` updated every 500ms) causes the timer to be cleared and rescheduled on every update. This creates significant JS timer churn and, in this case, prevented the `stallCount` from ever resetting during active playback.

**Action:** Isolate timer-based logic into its own `useEffect` that depends strictly on the state being timed (e.g., `stallCount`). This ensures the timer persists across renders of the high-frequency path and only reacts to actual state changes.

## 2026-07-18 - Isolating stable metadata in high-frequency update paths

**Learning:** Even with memoized components, high-frequency state updates (e.g., every 500ms) can trigger expensive React reconciliation across the entire sub-tree. Components that combine frequently changing values (currentTime) with static metadata (resolution, codecs) force the static parts to be reconciled unnecessarily.

**Action:** Isolate stable UI rows into dedicated memoized sub-components. By passing only necessary props and memoizing derived display strings (duration, bitrate labels) at the right level, we maximize React's bail-out potential and reduce JS thread overhead in hot paths.

## 2026-07-20 - Unnecessary JSX element reconstruction in mapped lists

**Learning:** Found that components mapping over arrays (like streams in settings, segments/variants in playlist metadata, and players in the multi-view grid) reconstruct the entire JSX element sub-tree on every single render cycle of their parent, even if the underlying data remains unchanged. This causes redundant Reconciliation work and garbage collection pressure, particularly for frequently updated views (such as the main screen during active logs stream, or settings screen during typing/testing).

**Action:** Wrap inline list mappings and grid-rendering JSX blocks in `useMemo` hooks. By memoizing the rendered array of React elements with appropriate dependencies, we enable React to completely skip Reconciliation and reuse existing elements directly, significantly optimizing the rendering path during high-frequency updates.

## 2026-07-22 - Storage Notification Batching and Subscription Stability

**Learning:** Found a performance bottleneck where asynchronous storage mutations sequentially writing updates (e.g., stream list and settings) triggered duplicate listener notifications. This caused downstream hooks to perform multiple redundant state updates and render cycles. Additionally, using a transient refresh key to force-trigger hook updates caused the global subscription to be torn down and recreated, breaking callback memoization stability.

**Action:** Design storage-saving methods to accept an optional `notify` parameter to skip notifications for intermediate writes and fire a single notification at the end of the transaction. Keep storage subscriptions alive for the lifetime of the hook (by omitting transient keys from the subscription `useEffect` dependency array) to achieve fully stable, memoized operations.

## 2026-07-24 - Callback Stability via Singleton State Reading

**Learning:** Passing local state or hooks-provided state variables as dependencies to interaction callback functions (such as toggle/selection handlers) causes those callbacks to be re-created on every state change. This breaks React.memo on downstream children rendered in list loops. Since settings and config are stored in a synchronous-read-capable singleton manager (streamStorage), reading the state synchronously inside the callback directly from the manager removes all state variables from the dependencies array, making the callback fully stable.

**Action:** When a callback modifies state and depends on other parts of that same state, retrieve the dependencies synchronously from a singleton or reference within the callback instead of using local state variables. This achieves O(1) callback reference stability and maintains the effectiveness of React.memo downstream.

## 2026-07-26 - Garbage collection pressure in high-frequency list filtering

**Learning:** During active stream playback, the log stream updates rapidly. If the user enters a filter query, the filtering logic runs on every log update. Performing `.toLowerCase()` inside the O(N) filtering loop on every single render creates hundreds of temporary string allocations, generating high garbage collection pressure on the JavaScript thread. Additionally, dynamic `.toUpperCase()` formatting inside list items allocates strings unnecessarily on every render cycle.

**Action:** Pre-calculate case-insensitive properties (like `messageLower`) exactly once when a log item is created. For finite string values (like log levels), replace dynamic string conversions with static O(1) constant-time lookup maps (like `UPPERCASE_LEVELS`) to completely eliminate heap allocation overhead in hot list rendering paths.
