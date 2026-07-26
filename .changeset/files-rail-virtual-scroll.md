---
"@skill-map/cli": patch
---

The files rail's table is virtualised: only the rows in the viewport render. On a 1000-node project an expanded tree drops from 19,663 rail DOM elements and 1,019 rows to 945 and 48, and a folder toggle from 95ms to ~53ms. Since Tab can no longer reach unmounted rows, the rail gains arrow-key navigation, `aria-rowcount` / `aria-rowindex`, and a focus rescue for recycled rows. Rows are a uniform 36px and no longer animate in.

## User-facing

The Files panel now draws only the rows on screen, so expanding or collapsing folders in a large project is immediate instead of stalling. You can also move through the list with the arrow keys: Enter opens a file, Space toggles it on the map.
