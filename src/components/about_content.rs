use leptos::prelude::*;

#[component]
pub fn AboutContent() -> impl IntoView {
    view! {
        <div class="about-body">
            <p>"View diffs for Rust crates and compare the source files published in different versions."</p>
            <h3>"How it works"</h3>
            <p>"The app is compiled to WebAssembly and runs entirely in your browser, with no backend. It fetches metadata from crates.io, downloads the published crate archives, verifies their SHA-256 checksums, and extracts their files in memory."</p>
            <h3>"Acknowledgements"</h3>
            <p>"Inspired by " <a href="https://github.com/xfbs/diff.rs">"the original diff.rs project"</a>
                ". Built with Leptos, Similar, Tar, and Flate2. File trees and syntax-highlighted diffs use "
                <a href="https://trees.software">"Pierre Trees"</a>" and "
                <a href="https://diffs.com">"Pierre Diffs"</a>"."</p>
        </div>
    }
}
