use crate::diff::comparison_url;
use leptos::prelude::*;
use leptos_router::{NavigateOptions, components::Redirect, hooks::use_params_map};

#[component]
pub fn BrowsePage() -> impl IntoView {
    let params = use_params_map();
    view! {
        {move || {
            let params = params.read();
            let name = params.get("krate").unwrap_or_default();
            let version = params.get("version").unwrap_or_default();
            view! {
                <Redirect path=comparison_url(&name, &version, &version, "")
                    options=NavigateOptions { replace: true, ..Default::default() }/>
            }
        }}
    }
}
