use super::{
    about_menu::AboutMenu, comparison_header::ComparisonHeaderMount, settings_menu::SettingsMenu,
};
use crate::search::search_url;
use leptos::prelude::*;
use leptos_router::hooks::use_navigate;

#[component]
pub fn Header(comparison_mounts: ComparisonHeaderMount) -> impl IntoView {
    let (query, set_query) = signal(String::new());
    let navigate = use_navigate();
    view! {
        <header class="navbar">
            <nav class="nav-content" aria-label="Main navigation">
                <div class="nav-left">
                    <a class="brand" href="/">
                        <img class="brand-logo" src="/logo.svg" alt="" width="36" height="36"/>
                        "Crate Diff"
                    </a>
                    <div class="comparison-header-slot" node_ref=comparison_mounts.identity/>
                </div>
                <div class="nav-comparison">
                    <div class="comparison-header-slot" node_ref=comparison_mounts.versions/>
                    <form class="header-search" role="search" aria-label="Header search" on:submit=move |event| {
                        event.prevent_default();
                        let query = query.get().trim().to_owned();
                        if !query.is_empty() {
                            navigate(&search_url(&query, 1), Default::default());
                        }
                    }>
                        <label class="sr-only" for="header-search">"Search for crates"</label>
                        <input id="header-search" type="search" placeholder="Search for crates"
                            required
                            prop:value=move || query.get()
                            on:input=move |event| set_query.set(event_target_value(&event))/>
                    </form>
                </div>
                <div class="nav-tools">
                    <AboutMenu/>
                    <SettingsMenu/>
                </div>
            </nav>
        </header>
    }
}
