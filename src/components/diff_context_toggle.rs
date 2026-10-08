use leptos::prelude::*;

#[component]
pub fn DiffContextToggle(expanded: ReadSignal<bool>, on_toggle: Callback<()>) -> impl IntoView {
    view! {
        <button class="diff-context-toggle" type="button" aria-label="Show all lines"
            title="Show all lines"
            aria-pressed=move || if expanded.get() { "true" } else { "false" }
            on:click=move |_| on_toggle.run(())>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d=move || if expanded.get() {
                    "M5.5 4.365286165l6.5 5.634713835 6.5-5.634713835M5.5 19.634713835l6.5-5.634713835 6.5 5.634713835"
                } else {
                    "M5.5 10.634713835l6.5-5.634713835 6.5 5.634713835M5.5 13.365286165l6.5 5.634713835 6.5-5.634713835"
                }/>
            </svg>
        </button>
    }
}
