## 2026-06-24 - Redundant upstream state updates

**Learning:** Found a performance bottleneck where a child component (`NetworkQualityIndicator`) was frequently reporting data via a callback (`onStatsUpdate`) to the main screen state, but this state was never consumed. This triggered a secondary re-render of the entire main component tree every 500ms (on every video time update) for no functional benefit.

**Action:** Before implementing or maintaining "upstream" state reporting (child-to-parent), verify that the parent actually consumes that state. Remove unused state setters from callbacks to prevent redundant re-render cycles in high-frequency update paths.
