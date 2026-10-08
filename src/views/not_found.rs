use crate::components::page_title::PageTitle;
use leptos::prelude::*;

const CRAB: &str = r#"    _~^~^~_
\) /  404  \ (/
  '_   ¬   _'
  / '-----' \"#;

#[component]
pub fn NotFound() -> impl IntoView {
    view! {
        <div class="not-found">
            <PageTitle/>
            <h1>"Page Not Found"</h1>
            <pre class="not-found-art" role="img" aria-label="Crab displaying 404">{CRAB}</pre>
        </div>
    }
}
