# crate-diff

See [the architecture documentation](docs/README.md) for module responsibilities,
data flow, renderer integration, and the build/deployment model.

A Leptos wasm application to view crate version diffs. The home page fetches live crates.io
summary data and lists **Most Downloaded** and **Just Updated**.
Compact cards show the version, description, total downloads, and links to
documentation and source repositories.

The home search field searches the full crates.io registry when you press Enter.
Typing leaves the Most Downloaded and Just Updated lists unchanged.
The search page updates after a short typing pause, shows 20 results per page,
and keeps the query and page in the URL for sharing, refreshes, and browser history.
The header search also opens registry results on Enter. Click a crate to compare
its previous and latest releases.
Choose versions, filter files, hide unchanged files, and inspect
unified or side-by-side diffs. Unchanged context can be expanded. Binary files
show their sizes instead of a text diff.

The header's settings button controls Light, Dark, or Auto appearance, diff font
size, Standard or Full screen workspace layout, and all bundled Shiki diff
schemes alongside Pierre Light/Dark. The scheme selector follows the active
appearance; light and dark choices are saved independently.
Full screen is the default unless Standard has been saved. It keeps the
header visible and lets the tree and diff scroll independently,
with no page scrolling. Comparison file/line counts
appear in a fixed row at the bottom of the file sidebar.
Standard uses the same height and panel scrolling with a centered, capped
workspace and matching header width.
Choose a system or installed monospace font, or preview and apply a custom font
family. Preferences are saved locally and synchronized between tabs.

## Pages and URLs

- `/`: crates.io summary lists.
- `/search`: search form.
- `/search/:query?page=2`: crates.io search results with optional pagination.
- `/debug`: localStorage and cache-size snapshots; linked from
  the About modal.
- `/404` and unmatched routes: page not found.
- `/crate/:crate`: compare the previous and latest published versions.
- `/crate/:crate/:old/:new`: compare specific versions.
- `/crate/:crate/:old/:new/*file`: share a comparison for a specific file.

Versions can be exact releases, `latest`, `previous`, or semver requirements.
For example, `/crate/serde/1.0.219/1.0.220/src/lib.rs`. Missing crates, versions,
and files show a not-found message.

Archives are fetched from the crates.io CDN, verified against the SHA-256
checksum supplied by crates.io, and unpacked in memory. Metadata and a small
number of archives are cached for the browser session. Comparisons run locally.
The sidebar uses `@pierre/trees` to display the complete file hierarchy with
expandable folders, compact rows, standard file icons, and added/deleted/modified badges. All files,
including unchanged files, appear by default. Badge tooltips show line counts.
`@pierre/diffs` renders syntax highlighting, inline changes, line numbers,
unified/split layouts, and expandable unchanged context. Both follow the system
light/dark theme. Highlighting assets are bundled and served with the site.
The Files toolbar contains search, changed-files-only, and Collapse folders
icons. Search appears when its icon is pressed. Collapse folders closes all
open directories like VS Code. The 300 px sidebar and code panel
share a divider; the standard page width is 1240 px.

## Source layout

- `src/app.rs`: layout and routes.
- `src/views/`: Home, Search, Debug, Not Found, and comparison pages.
- `src/components/`: navigation, cards, version controls, file list,
  the About modal, and diff rendering.
- `src/data.rs`: home page metadata.
- `src/search.rs`: search response data, URL encoding, and crates.io requests.
- `src/diff.rs`: version resolution, archive loading, and diff computation.
- `js/pierre.js`: vanilla Pierre renderers and their Leptos lifecycle bridge.
- `scripts/build-ui.mjs`: bundles the JavaScript and lazy highlighting assets.

## Run locally

Install Node.js 20+, Rust, the WebAssembly target, and Trunk:

```sh
rustup target add wasm32-unknown-unknown
cargo install trunk --locked
npm ci
```

Start the development server:

```sh
NO_COLOR=true trunk serve
```

Open `http://127.0.0.1:8080`. An internet connection is needed to load crates.io
data. Failed requests show an error message and a retry button.

## Build

```sh
cargo fmt --check
cargo test
npm test
cargo clippy --target wasm32-unknown-unknown -- -D warnings
cargo check --target wasm32-unknown-unknown
NO_COLOR=true trunk build --release
npm run size:wasm
```

Trunk runs `npm run build` before each build and copies the generated assets.
The `dist/` directory contains the static site. No application backend, API key,
or Tailwind build is needed.

Release builds use size-focused Rust optimization, Leptos component erasure for
the WebAssembly target, and repeated `wasm-opt -Oz` passes. The size command
reports the Wasm artifact and estimated gzip/Brotli transfer sizes. To measure
another build directory, run `npm run size:wasm -- /path/to/build`.
See [Frontend and build](docs/frontend.md#webassembly-size) for the configuration
and rendering tradeoff.

Static hosting must serve `index.html` for application routes so direct
comparison links and refreshes work. Trunk's development server provides this
fallback. The app displays its own 404 page after routing; a static host serves
the application shell with HTTP 200.

For the file-tree lifecycle browser regression, start `trunk serve`, then run:

```sh
npx playwright install chromium
npm run test:browser
```

Set `TEST_BASE_URL` if the server uses another address. The test supplies local
crate metadata and archive fixtures, so it needs no registry connection.
