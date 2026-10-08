# Display settings

[`SettingsMenu`](../src/components/settings_menu.rs) adds a native dialog to the
shared header. It controls appearance, diff font size, workspace layout, diff
schemes, and the monospace font. Changes apply immediately. Escape, Done, the
close button, and clicking outside dismiss the dialog.
Appearance and Workspace layout use button bars that expose the selected option
through `aria-pressed`. Select menus keep their arrows inset from the edge.

## Store and startup

[`js/settings.js`](../js/settings.js) owns the shared store and exposes
`window.CrateSettings`. [`src/settings.rs`](../src/settings.rs) defines Rust
bindings and snapshot types. Its `use_settings` helper subscribes the menu
to JSON snapshots, and unsubscribes before releasing its Rust callback.

| Storage key | Value |
| --- | --- |
| `crate-diff.settings` | JSON with `mode`, `fontSize`, `codeWidth`, `lightTheme`, and `darkTheme` |
| `font-mono` | Font label; absent for App default |

A small synchronous `assets/settings.js` bundle applies preferences in the
document head before the workspace renders. Storage access is guarded:
unsupported values fall back to defaults, and blocked storage leaves the
settings functional for the page session. Storage events synchronize tabs.
Reset removes both keys and restores Auto, 12 px, Full screen layout,
Pierre Light/Pierre Dark, and App default.

## Appearance and schemes

Auto resolves through `matchMedia('(prefers-color-scheme: dark)')` and follows
changes. Light and Dark override the system. The resolved mode sets `data-theme`
on the root; CSS `color-scheme` and `light-dark()` tokens apply the palette to
the page, native controls, and tree. Browser theme-color metadata follows it.

Mounted diff renderers subscribe to the store, call `setThemeType` for mode
changes, and update rendering options for scheme changes. Cleanup removes their
subscriptions.

[`js/settings-values.js`](../js/settings-values.js) contains defaults, size
choices, and `DIFF_THEMES`. It includes Pierre Light/Dark plus all bundled Shiki
themes, grouped by their declared light/dark appearance. Pierre appears first;
the remaining choices are sorted by label.
[`scripts/generate-themes.mjs`](../scripts/generate-themes.mjs) builds the checked-in
[`js/shiki-themes.js`](../js/shiki-themes.js) metadata catalog from the installed
Shiki dependency during builds and JavaScript tests. Only changed content is
written, so Trunk's watcher does not rebuild in a loop. The synchronous settings
bundle contains labels and IDs; actual theme definitions stay in lazy Pierre
chunks served with the site.

[`DiffSchemeSelect`](../src/components/diff_scheme_select.rs) shows one selector
for the resolved appearance, including system changes in Auto mode. It updates
only that appearance's preference. `lightTheme` and `darkTheme` remain separate
fields in the stored JSON and are restored when switching modes or reloading.
Themes for the wrong appearance are rejected when loading or updating settings.

Size changes set `--diff-font-size` and `--diff-line-height`, which the host maps
to Pierre's CSS variables. They affect code layout without loading archives.

## Workspace layout

Full screen is the default for new preferences and Reset to defaults. Saved
Standard choices remain in effect. The retired Wide value is migrated to
Full screen on load, preserving the other saved preferences.

Standard keeps the comparison layout capped at 1240 px and centers the header
contents at the same width. The workspace meets the header and extends to the
viewport bottom without vertical margins or padding. Smaller screens retain
their responsive side gutters. Other pages keep their usual width.

Full screen uses the full viewport width for the header and workspace.
Both layouts fill the viewport below the shared header to the bottom edge.
The tree and diff scroll independently, and document scrolling is disabled.
Changed-file and line counts sit in a fixed bottom row of the file sidebar,
outside the tree's scroll area. The row is hidden with the sidebar when it is
collapsed. Smaller screens stack the two bounded panels.
Loading and error messages stay within the workspace. Leaving the comparison
restores normal page scrolling; the saved layout applies again on return.

The store applies `data-code-width` to the root at startup and on changes.
[`style.css`](../style.css) adjusts the comparison containers through
`--container-max-width` and constrains both comparison flex/grid layouts with
`100dvh` and `min-height: 0`. The stored `codeWidth` values are `standard`
and `fullscreen`. Layout changes need no archive downloads.

## File tree toolbar

The Files header contains Search files, Changed files only, Collapse folders,
and Hide file sidebar icons. Search is initially hidden. Its icon reveals and focuses the filter;
pressing it again or Escape closes the field and clears the text filter.
Changed files only uses a file icon with plus/minus marks and a pressed state.
Collapse folders closes every open directory, including descendants, like
VS Code's Collapse Folders action. The currently displayed diff stays selected.
These controls belong to the current comparison rather than saved settings.
Hide file sidebar gives more space to the diff and leaves a Show file sidebar
icon in a slim strip (above the diff on narrow screens). Hiding and showing
preserve folder expansion and filters. Visibility survives version changes
but is not saved between page loads.
The obsolete `compactFolders` preference is ignored when loading old settings.

Tree rows always use Pierre's compact density (24 px) and standard built-in
icon set. The desktop sidebar is 300 px wide and shares a border with the code
panel. The standard page cap increased by the same 40 px as the sidebar.

## Monospace fonts

[`js/fonts.js`](../js/fonts.js) converts labels to safely quoted CSS stacks.
App default removes the override; System monospace uses the browser's generic
family. Named fonts receive system fallbacks.

The effective stack overrides `--font-mono` on the body, or temporarily on the
root before the body exists at startup. Code, diff hosts, file headings, and
version labels consume it. Body text keeps the application's system UI font.

The baseline options are App default, System monospace, Monaco, Menlo, and
Consolas. Opening settings probes a curated list of coding fonts with
canvas metrics, once per session. Find installed fonts explicitly invokes Local
Font Access when available, filtering returned families by monospace metrics.
Unavailable or denied access falls back to the curated probe. No fonts are
downloaded.

Custom font accepts another installed family. Typing previews it without saving;
Apply stores the label. Closing the dialog or selecting another font clears the
preview and restores the saved preference. Stored custom labels stay in the
picker before detection runs.
Invalid saved font preferences revert to App default and clear the stored override.

## Validation

`npm test` runs [`tests/settings.test.mjs`](../tests/settings.test.mjs), covering
label/stack behavior, font-name escaping, and stored-value normalization.
Browser checks cover persistence, cross-tab events, forced/Auto appearance,
shadow DOM font styles, font detection, and native dialog behavior.
