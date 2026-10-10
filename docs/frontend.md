# Frontend and build

## Leptos component ownership

[`App`](../src/app.rs) supplies the router, shared header, main content,
and a `ComparisonHeaderMount` context containing DOM node references for crate
identity and version controls.
Page views own their request resources and derive state from route parameters.
Components receive the data and callbacks needed to render their part of a page.
The document's default title is
`Crate Diff - Compare diffs for Rust crate versions`. Routed views mount the
shared [`PageTitle`](../src/components/page_title.rs) component; `DiffPage`
supplies a reactive `{crate name} - Crate Diff` title from its route. Other
pages use the default. Each incoming page sets its own title, so cleanup of an
outgoing page cannot overwrite it during navigation.

The comparison page uses these components:

| Component | Owns |
| --- | --- |
| `CrateComparison` in [`DiffPage`](../src/views/diff.rs) | Version/source resources and sidebar visibility across version changes |
| [`ComparisonHeader`](../src/components/comparison_header.rs) | Crate identity and resolved version controls in the shared header |
| [`DiffWorkspace`](../src/components/diff_workspace.rs) | File change statistics, selected-file memo, and sidebar/panel composition |
| [`FileTree`](../src/components/file_tree.rs) and [`FilePanel`](../src/components/diff_view.rs) | Local filters/display options, renderer hosts, browser instances, and cleanup |
| [`SidebarToggle`](../src/components/sidebar_toggle.rs) | Accessible hide/show icon shared by the Files toolbar and collapsed strip |

`ComparisonHeader` uses Leptos portals to mount the crate identity and version
controls into separate header slots while remaining owned by the routed
comparison view. The separate slots let mobile search and version controls
share a row with widths independent of the logo and icons. This keeps metadata
and version resolution in the comparison page and lets its controls use the
route context. Leaving the comparison disposes the portal content. The shared
logo and right-side navigation are rendered by `Header`.
All pages share the same compact header spacing: a 56 px navigation row on
desktop, 16 px left padding, 8 px padding on the other sides, and 34 px controls.
The logo is 36 px on desktop and 32 px on narrow screens.
In Standard comparison mode the header contents match the centered workspace
width. Full screen and other pages use the full viewport width for the header.
At widths up to 950 px, the header uses two rows. The logo, crate name, and
Settings icon share the first row. Compact From/To selectors followed
by search share the second row on comparisons; search fills that row on other pages
except Home and search results, which have their own search forms. Their header
search is hidden and the header stays on one row.
The header's Search for crates field submits to registry search on Enter,
including exact crate names. Selecting a result opens its comparison page.
The Settings icon opens [`SettingsMenu`](../src/components/settings_menu.rs),
a shared native dialog with Settings and About tabs. Settings opens by default.
The tabs use arrow keys, Home, and End for selection and keep settings mounted
while switching. [`AboutContent`](../src/components/about_content.rs) owns the
project information. Opening the dialog preserves the route, title, and workspace.
Escape, the close button, Done, or a backdrop click dismiss it. Content scrolls
within the bounded dialog while its tabs and footer stay visible. The About tab's
Debug link closes the modal and navigates within the app, preserving source and
metadata caches for inspection.

`DiffWorkspace` passes its comparison summary as child content to `FileTree`,
which mounts it at the bottom of the sidebar, outside the scrolling tree host.
Its counts cover all compared files and remain unchanged by file filters.
Hiding the sidebar also hides the summary; leaving the comparison disposes it.
The app has no page footer.

Version dropdown changes retain the selected file in the comparison
URL. Selecting a file updates the URL through the tree callback. The sidebar
stays mounted during file navigation; the selected file panel is rebuilt with
its own display state.
Hiding the sidebar keeps its tree mounted and preserves folders and filters.
The workspace gives the recovered space to the diff, leaving a slim strip with
the show icon. Keyboard focus follows the toggle when hiding or showing.
Sidebar visibility belongs to the comparison view and survives version changes;
it starts expanded on a fresh page.
Crate cards use `crate_url` for `/crate/{name}`, and comparisons use
`comparison_url` for `/crate/{name}/{old}/{new}/{file}`. This keeps short links,
resolved-version redirects, version controls, and file selection under the
same route prefix.

## Rust–JavaScript bridge

[`src/components/pierre.rs`](../src/components/pierre.rs) declares
`wasm-bindgen` imports from the `Pierre` browser namespace.
[`js/pierre.js`](../js/pierre.js) exposes that namespace as `window.Pierre`.

| Function | Input and purpose |
| --- | --- |
| `mountTree` | DOM host, JSON file changes, selected path, Rust callback; creates a Pierre `FileTree` |
| `updateTree` | Instance, JSON visible paths, selected path; updates filtering and selection |
| `collapseTree` | Instance; collapses all directory handles while retaining the selected diff |
| `mountDiff` | DOM host, filename, optional old/new text, identical flag; creates `File` or `FileDiff` |
| `updateDiff` | Instance, split-mode flag, all-lines flag; updates options and renders |
| `cleanUp` | Instance; releases the library renderer |

Each wrapper uses a `NodeRef` to wait for its host before constructing a
renderer. Browser handles live in `StoredValue::new_local` because JavaScript
values and callbacks belong to the browser thread.

The Rust `Renderer` wrapper calls `cleanUp` on drop. Component `on_cleanup`
handlers take the renderer out of storage to trigger that drop. The tree
releases its Rust callback after cleaning up the JavaScript instance.
Pierre's tree cleanup leaves its `file-tree-container` element in the outer
host. The JavaScript bridge also removes that instance's container, so replacing
a comparison in a reused Leptos host cannot leave an empty full-height tree
ahead of the new one.

### Tree synchronization

The tree receives all file paths, initially expanded folders, file icons, and
added/deleted/modified status entries. Line-count decorations use the Rust
statistics. The Rust wrapper applies the text filter and changed-files-only
filter and sends the resulting visible paths to `updateTree`.
Two nonbreaking spaces between the colored line counts preserve the gap inside
Pierre's decoration spans when both counts are nonzero. Zero counts are omitted.
The tree's `unsafeCSS` option reserves the count lane while the filename takes
the remaining width and uses Pierre's middle truncation. Status letters keep
their fixed lane. Status letters remain in the tree; there is no legend.
The Files header contains icon buttons with tooltips and accessible names.
Search opens and focuses the filter input; closing it or pressing Escape clears
the filter. The file icon with plus/minus marks toggles changed-files-only
filtering, with its state exposed through `aria-pressed`.
The tree uses `density: 'compact'` and the standard icon set. Collapse folders
walks directory handles from deepest to shallowest and calls `collapse()`.
This closes nested folders too, keeps the selected diff and filters, and
operates on the current renderer. It does not recreate the tree or navigate.

JavaScript resets paths only when that visible path list changes. It
synchronizes selection from the route, reveals ancestors as needed, and
suppresses selection callbacks during programmatic updates. This prevents
route-driven selection from recursively navigating again. Directory selection
does not navigate to a file.

### Diff rendering

Unchanged text uses Pierre `File`; changed text uses `FileDiff` with
`parseDiffFromFile`. The renderer receives the filename to identify its syntax
language. The [`DiffLayoutToggle`](../src/components/diff_layout_toggle.rs)
offers a single icon button that starts in Stacked and toggles to Split. The
icon reflects the current layout, with a tooltip for the next action and
`aria-pressed` indicating Split mode. Stacked maps to Pierre's `unified` layout.
Layout and full-context mode are Leptos signals applied through `setOptions` and rendering
on the existing instance.
[`DiffContextToggle`](../src/components/diff_context_toggle.rs) controls full
context with an icon button, a Show all lines tooltip, and `aria-pressed`.
Change indicators use Pierre's `bars` style in both unified and split views.

Pierre owns the internal code markup, syntax tokens, word-level changes, line
numbers, and per-hunk expansion. Leptos owns the filename toolbar, display
controls, notices, and outer panel.

## Styling

[`style.css`](../style.css) defines subtly blue-gray light and dark tokens for
backgrounds, surfaces, text, borders, accents, and selection. The folder area
uses a darker `--tree-background` extending to the sidebar edges and bottom;
its compact toolbar keeps the regular surface. Additions, deletions, and
modified-file indicators retain distinct semantic colors.
Home uses two columns and a short heading above its central search form. Home and
search results share compact card spacing and larger version labels.
The page layout adapts the compact header and sidebar at smaller widths.
Both comparison layouts give the app a bounded `100dvh` layout below the fixed header,
extending to the viewport bottom. The tree's own virtualized scroll area and the diff host scroll
independently; the document stays still. On narrow screens the two panels
stack within the same bounded workspace. The summary stays pinned to the
sidebar bottom. Standard caps the header contents and workspace at the same
1240 px width, filling the viewport without side gutters at or below that width;
Full screen uses the full viewport width. Neither comparison
layout has top or bottom workspace gutters.

Pierre components render their internals in shadow DOM. The tree host receives
the supported `--trees-*-override` custom properties so it follows the
application palette. The diff host inherits the configured font size and
monospace family. The JavaScript renderer uses the selected Pierre light/dark
schemes with the resolved appearance mode. See [Display settings](settings.md).
Regular page
CSS selectors do not style the internals of those shadow roots.

## Build and delivery

[`Trunk.toml`](../Trunk.toml) orchestrates the build:

1. Its `pre_build` hook runs `npm run build`.
2. [`scripts/build-ui.mjs`](../scripts/build-ui.mjs) refreshes the Shiki theme
   metadata catalog when it changes, then recreates `public/assets`
   and bundles the small synchronous `js/settings.js` startup script plus
   `js/pierre.js` with esbuild. Pierre output is minified browser ESM with
   code splitting and an ES2022 target.
3. [`index.html`](../index.html) tells Trunk to compile Rust to WebAssembly,
   process `style.css`, and copy the generated assets directory. It also copies
   the checked-in [`public/logo.svg`](../public/logo.svg) and
   [`public/favicon.ico`](../public/favicon.ico), along with the social preview
   image, to the site root. The shared
   header uses `/logo.svg` beside the Crate Diff name, and the document declares
   `/favicon.ico` as its favicon. These source assets remain separate from the
   generated directory that esbuild recreates.
   The application loads Inter's variable weights from Google Fonts with
   `display=swap` and preconnects to its stylesheet and font hosts. `style.css`
   uses Inter as the main sans-serif font, with system font fallbacks. Code
   and diff text continue to use the separate monospace preference.
4. Trunk gives both JavaScript entry bundles content-hashed filenames. The page
   first loads `/assets/settings-<hash>.js`, then `/assets/pierre-<hash>.js`;
   changed bundles receive new URLs so browser/CDN caches cannot reuse an older
   entry bundle with the new HTML. Both remain in `/assets/` so relative imports
   resolve correctly. Highlighting modules are loaded from
   locally served chunks when needed. Release builds also optimize WebAssembly
   through the configured `data-wasm-opt="z"` setting and `--converge`, which
   repeats optimization passes while the binary continues to shrink.
5. Trunk publishes the static site into `dist/`.

`Cargo.lock` and `package-lock.json` record the Rust and npm dependency
resolutions. Install npm dependencies with `npm ci` before running Trunk.
Generated `target/`, `dist/`, `node_modules/`, and `public/assets/` directories
are ignored by Git. Trunk ignores `node_modules` and `public/assets` when
watching source changes; updates to the source logo and favicon trigger a build.

Assets are currently referenced from the site root. Deploy `dist/` with a
fallback to `index.html` for application routes so a direct comparison link or
search-page refresh can initialize the router. Missing static assets should
still return an asset error. The application displays routed not-found states;
the static application's fallback document is normally served with HTTP 200.

### Link previews

[`index.html`](../index.html) includes Open Graph metadata in
the static HTML so crawlers can read the site title, description, production URL,
and preview image without running WebAssembly. The tags use absolute HTTPS URLs
for `cratediff.com`, and include the image's type, dimensions, and alt text.

[`public/social-preview.png`](../public/social-preview.png) renders the existing
crate logo above the site name in bold Inter text colored `rgb(85, 65, 49)`, centered on a neutral
background at 1200 × 630 pixels. It is checked
in and copied by Trunk, so deployment does not require a browser to generate it.
After changing the source logo, font, or preview styling, regenerate it with:

```sh
npx playwright install chromium
npm run generate:preview
```

The [generator](../scripts/generate-social-image.mjs) uses the project's existing
Playwright dependency and embeds a local Inter 4.1 font from `scripts/fonts/`,
waiting for it to load before capturing the image. This font is used only to
generate the preview and is not copied into the deployed site; its SIL Open Font
License is included in [`scripts/fonts/OFL.txt`](../scripts/fonts/OFL.txt).
The metadata describes the site as a whole. GitHub Pages
serves direct application routes through `404.html` with HTTP status 404, which
some preview crawlers reject even when the HTML contains these tags.

### WebAssembly size

[`Cargo.toml`](../Cargo.toml) uses `opt-level = "z"`, full link-time optimization,
one codegen unit, aborting panics, and stripped debug information for release
builds. [`index.html`](../index.html) then runs `wasm-opt -Oz --converge` through
Trunk.

[`.cargo/config.toml`](../.cargo/config.toml) enables Leptos's
`--cfg=erase_components` for the `wasm32-unknown-unknown` target. Leptos shares
view and reactive closure implementations instead of generating a separate
implementation for every concrete type. This adds allocations and dynamic
dispatch during rendering in exchange for less generated code. The flag applies
to browser builds; native Rust tests use their usual component types.

Measure the actual packaged artifact after a production build:

```sh
NO_COLOR=true trunk build --release --locked
npm run size:wasm
```

[`scripts/wasm-size.mjs`](../scripts/wasm-size.mjs) reports bytes for each Wasm
artifact, gzip at level 9, and Brotli at quality 11. It accepts an optional build
directory: `npm run size:wasm -- /path/to/build`. Compression figures estimate
the transfer size when the static host enables the corresponding content
encoding. The command does not change the artifacts or hosting configuration.
Pierre, Shiki, and their lazy JavaScript chunks remain separate from Wasm and
are excluded from these measurements.

The October 8, 2026 comparison used Rust 1.99.0, Trunk 0.21.14, and identical
application sources and locked dependencies. The baseline used `opt-level = "s"`
with `wasm-opt -Oz`; the optimized build uses the configuration above.

| Packaged Wasm | Before (bytes) | After (bytes) | Reduction |
| --- | ---: | ---: | ---: |
| Uncompressed | 937,114 | 764,702 | 18.4% |
| Gzip | 368,280 | 317,036 | 13.9% |
| Brotli | 286,776 | 254,561 | 11.2% |

## Validation and changes

The [project README](../README.md#build) lists formatting, native tests,
WebAssembly checks, and production build commands.

Committed Rust tests cover archive checksums and paths, duplicate entries, file
classification, version precedence/resolution, and URL/search response handling.
They do not exercise the browser DOM or the JavaScript renderer lifecycle.
Browser verification is needed for changes to the portal, route transitions,
tree selection, diff display options, responsive layout, or theme handling.
`npm test` covers settings normalization and font stack handling in JavaScript.
`npm run test:browser` uses Playwright against a running development server.
Install both Chromium and Firefox for the modal's dropdown-dismissal regressions.
Its file-tree lifecycle regression supplies checksummed archive fixtures and
checks downloads, cached comparisons, filters, route changes, reloads,
narrow layouts, appearance button bars, and saved code width. See the
[README](../README.md#build) for setup.
It also checks compact row height, joined panel geometry, recursive folder
collapse, search visibility/focus/Escape, and the changed-files icon.
Large archive fixtures verify full-screen panel scrolling, sidebar summary placement,
viewport changes, persistence, and restoration of normal scrolling on exit.

When extending the application, put page orchestration in `src/views`, reusable
UI in `src/components`, request/data logic in its Rust module, and Pierre-specific
DOM operations in `js/pierre.js`. Keep URL state and renderer-local state
separate, and pair new browser resources with cleanup in the owning component.
