# Benchmark and research workspace

The web dashboard combines public, read-only commodity reference observations with personal research stored in the current browser.

## Explore benchmarks

- Use **Table** for saved views and **Cards** for an overview.
- Filter by category, frequency, observation availability, historical direction, or watchlist membership. Filters combine with search.
- Sort a property from its header. Shift-click adds another sort priority. Missing values stay last.
- **Properties** controls visibility, order, width, and row density. The benchmark name remains visible. Resize with a header edge or its arrow keys.
- A saved view records its filters, sort order, properties, density, and observation range. Save updates explicitly using **View settings**.
- Select rows to add watches, create research entries, compare two to four benchmarks, or export the selection. **Actions** also exports filtered results or all loaded observations. Exports contain raw values and observation metadata.

Open a benchmark to see its source, history, and observation table. Comparisons default to an index of 100 at each series' first available observation within the selected span. Baseline dates are disclosed; differing baselines and source schedules affect interpretation. Absolute comparisons are available only when units and currencies match.

The sidebar Watchlist further restricts the current table view. Its membership and view preferences stay in the current browser.

## Write research

Create a standalone entry or add benchmarks from the table or detail panel. Linked observations are a fixed source snapshot; editing your notes does not edit public data or refresh that snapshot.

Entries support a title, status, tags, notes, citations, and personal text, number, date, checkbox, and select properties. Research views save search, status, sorting, property order, and visibility. Research uses accessible entry forms rather than spreadsheet cell navigation. Escape within a field restores its value from when the field received focus.

Edits save locally. Check the save indicator: failed saves offer retry and backup recovery. Archive keeps an entry recoverable; Undo is available for the current session. Clearing browser storage or changing browsers can remove access to local work.

**Export backup** creates a JSON file containing entries, properties, drafts, and saved views. **Import backup** validates the file and shows a preview before applying it. Merge keeps the newer entry when IDs match, preserves saved views, and assigns new IDs to conflicting views. Incompatible property definitions are rejected. Replace uses the imported workspace and can be undone during the session. Import supports BenchmarkWatcher Research JSON backups, not Excel workbooks or arbitrary CSV files.

Limits are 5,000 entries, 30 personal properties, and 40 saved Research views. There is no account sync, shared editing, workbook formula engine, or external AI transfer in this browser workspace.

## Find and return

Use the header search or Cmd/Ctrl+K to find benchmark names and local research. Keyboard users can move through search results with the arrow keys. Browser Back and Forward preserve the selected observation range and workspace; leaving an open research editor closes the dialog while retaining its draft.

All benchmark values remain historical observations for informational and reference use. Source gaps, delays, different frequencies, and revisions are expected.
