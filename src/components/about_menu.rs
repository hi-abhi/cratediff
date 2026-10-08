use leptos::{html, prelude::*};

#[component]
pub fn AboutMenu() -> impl IntoView {
    let dialog = NodeRef::<html::Dialog>::new();
    let close = move || {
        if let Some(dialog) = dialog.get_untracked() {
            dialog.close();
        }
    };
    view! {
        <button class="about-trigger" type="button" aria-label="About" title="About"
            aria-haspopup="dialog" aria-controls="about-dialog"
            on:click=move |_| {
                if let Some(dialog) = dialog.get_untracked() {
                    let _ = dialog.show_modal();
                }
            }>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-.8.7-2 1.2-2 2.5M12 16h.01"/>
            </svg>
        </button>
        <dialog id="about-dialog" class="about-dialog" node_ref=dialog aria-labelledby="about-title"
            on:click=move |event| {
                if let Some(dialog) = dialog.get_untracked() {
                    let rect = dialog.get_bounding_client_rect();
                    let x = f64::from(event.client_x());
                    let y = f64::from(event.client_y());
                    if x < rect.left() || x > rect.right() || y < rect.top() || y > rect.bottom() {
                        close();
                    }
                }
            }>
            <div class="about-heading">
                <h2 id="about-title">"About Crate Diff"</h2>
                <button class="about-close" type="button" aria-label="Close about"
                    on:click=move |_| close()>"×"</button>
            </div>
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
            <div class="about-footer">
                <a href="/debug" on:click=move |_| close()>"Debug"</a>
                <button class="button" type="button" on:click=move |_| close()>"Done"</button>
            </div>
        </dialog>
    }
}
