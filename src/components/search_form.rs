use leptos::prelude::*;

#[component]
pub fn SearchForm(
    query: Signal<String>,
    on_input: Callback<String>,
    on_search: Callback<String>,
    id: &'static str,
    #[prop(default = "Search for crates")] placeholder: &'static str,
    #[prop(default = "Search crates.io")] label: &'static str,
    #[prop(default = "Search")] button_label: &'static str,
    #[prop(default = true)] show_button: bool,
) -> impl IntoView {
    view! {
        <form class="search search-form" role="search" on:submit=move |event| {
            event.prevent_default();
            on_search.run(query.get_untracked());
        }>
            <label class="sr-only" for=id>{label}</label>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <circle cx="10.5" cy="10.5" r="6.5"/>
                <path d="m16 16 5 5"/>
            </svg>
            <input id=id type="search" placeholder=placeholder autocomplete="off"
                prop:value=move || query.get()
                on:input=move |event| on_input.run(event_target_value(&event))/>
            {show_button.then(|| view! { <button class="button" type="submit">{button_label}</button> })}
        </form>
    }
}
