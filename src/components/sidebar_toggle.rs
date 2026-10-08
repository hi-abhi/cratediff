use leptos::{html, prelude::*};

#[component]
pub fn SidebarToggle(
    open: ReadSignal<bool>,
    toggle: Callback<()>,
    button_ref: NodeRef<html::Button>,
) -> impl IntoView {
    let label = move || {
        if open.get() {
            "Hide file sidebar"
        } else {
            "Show file sidebar"
        }
    };
    view! {
        <button class="tree-action" type="button" node_ref=button_ref
            aria-label=label title=label aria-controls="file-sidebar"
            aria-expanded=move || if open.get() { "true" } else { "false" }
            on:click=move |_| toggle.run(())>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
                <path d=move || if open.get() { "m16 9-3 3 3 3" } else { "m13 9 3 3-3 3" }/>
            </svg>
        </button>
    }
}
