use leptos::prelude::*;

#[component]
pub fn DiffLayoutToggle(split: ReadSignal<bool>, on_select: Callback<bool>) -> impl IntoView {
    view! {
        <button class="diff-layout-toggle" type="button" aria-label="Split view"
            aria-pressed=move || if split.get() { "true" } else { "false" }
            title=move || if split.get() { "Switch to stacked view" } else { "Switch to split view" }
            on:click=move |_| on_select.run(!split.get_untracked())>
            <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="currentcolor"
                viewBox="0 0 16 16" width="16" height="16" class="pi">
                <Show when=move || split.get() fallback=|| view! {
                    <path fill-rule="evenodd" d="M16 14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8.5h16zm-8-4a.5.5 0 0 0-.5.5v1h-1a.5.5 0 0 0 0 1h1v1a.5.5 0 0 0 1 0v-1h1a.5.5 0 0 0 0-1h-1v-1A.5.5 0 0 0 8 10" clip-rule="evenodd"/>
                    <path fill-rule="evenodd" d="M14 0a2 2 0 0 1 2 2v5.5H0V2a2 2 0 0 1 2-2zM6.5 3.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" clip-rule="evenodd" opacity="0.4"/>
                }>
                    <path d="M14 0H8.5v16H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m-1.5 6.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0"/>
                    <path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5V0zm.5 7.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1" opacity="0.3"/>
                </Show>
            </svg>
        </button>
    }
}
