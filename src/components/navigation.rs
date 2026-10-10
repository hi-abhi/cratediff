use super::{comparison_header::ComparisonHeaderMount, settings_menu::SettingsMenu};
use crate::search::search_url;
use leptos::prelude::*;
use leptos_router::hooks::{use_location, use_navigate};

#[component]
pub fn Header(comparison_mounts: ComparisonHeaderMount) -> impl IntoView {
    let (query, set_query) = signal(String::new());
    let navigate = use_navigate();
    let location = use_location();
    let is_home = Memo::new(move |_| location.pathname.get() == "/");
    let on_search = Callback::new(move |event: leptos::ev::SubmitEvent| {
        event.prevent_default();
        let query = query.get().trim().to_owned();
        if !query.is_empty() {
            navigate(&search_url(&query, 1), Default::default());
        }
    });
    view! {
        <header class="navbar">
            <nav class="nav-content" class:home-header=move || is_home.get() aria-label="Main navigation">
                <div class="nav-left">
                    <a class="brand" href="/">
                        <img class="brand-logo" src="/logo.svg" alt="" width="36" height="36"/>
                        "Crate Diff"
                    </a>
                    <div class="comparison-header-slot" node_ref=comparison_mounts.identity/>
                </div>
                <div class="nav-comparison">
                    <div class="comparison-header-slot" node_ref=comparison_mounts.versions/>
                    <Show when=move || !is_home.get()>
                        <form class="header-search" role="search" aria-label="Header search"
                            on:submit=move |event| on_search.run(event)>
                            <label class="sr-only" for="header-search">"Search for crates"</label>
                            <input id="header-search" type="search" placeholder="Search for crates"
                                required
                                prop:value=move || query.get()
                                on:input=move |event| set_query.set(event_target_value(&event))/>
                        </form>
                    </Show>
                </div>
                <div class="nav-tools">
                    <SettingsMenu/>
                </div>
            </nav>
        </header>
    }
}
