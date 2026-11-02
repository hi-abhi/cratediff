use super::{diff_context_toggle::DiffContextToggle, diff_layout_toggle::DiffLayoutToggle};
use crate::settings::set_setting;
use leptos::prelude::*;

#[component]
pub fn DiffToolbar(
    full_diff: Memo<bool>,
    toggle_full_diff: Callback<()>,
    all_lines: ReadSignal<bool>,
    toggle_all_lines: Callback<()>,
    split: Memo<bool>,
    children: Children,
) -> impl IntoView {
    view! {
        <div class="diff-toolbar" role="toolbar" aria-label="Diff viewer controls">
            <div class="diff-toolbar-start">
                <button class="full-diff-toggle" type="button"
                    aria-pressed=move || full_diff.get().to_string()
                    title=move || if full_diff.get() { "Switch to single-file view" } else { "View all changed files" }
                    on:click=move |_| toggle_full_diff.run(())>
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="2" width="12" height="12" rx="2"/>
                        <Show when=move || full_diff.get()>
                            <path class="full-diff-check" d="m4.5 8 2.5 2.5 4.5-5"/>
                        </Show>
                    </svg>
                    "Show all changes"
                </button>
                {children()}
            </div>
            <div class="diff-options">
                <DiffContextToggle expanded=all_lines on_toggle=toggle_all_lines/>
                <DiffLayoutToggle split=split
                    on_select=Callback::new(move |value| set_setting("diffLayout", if value { "split" } else { "stacked" }))/>
            </div>
        </div>
    }
}
