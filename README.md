# Crate Diff

[cratediff.com](https://cratediff.com/) is a web application to compare diffs between versions of Rust crates.

It is a WebAssembly binary that runs entirely in the browser and doesn't need a
backend. Crate Diff is inspired by diff.rs. The app uses Leptos as the frontend
framework and talks directly to the crates.io API.

## Routes

- `/`: crates.io summary lists.
- `/search/:query?page=<N>`: crates.io search results with optional pagination.
- `/crate/:crate`: compare the previous and latest published versions.
- `/crate/:crate/:old/:new`: compare specific versions.
- `/crate/:crate/:old/:new/*file`: share a comparison for a specific file.

Versions can be exact releases, `latest`, or `previous`.

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
The `dist/` directory contains the static site. Static hosting must serve
`index.html` for application routes so direct comparison links and refreshes work.

For the file-tree lifecycle browser regression, start `trunk serve`, then run:

```sh
npx playwright install chromium firefox
npm run test:browser
```

---

![](/public/logo.svg)
