use crate::data::{Crate, format_downloads, safe_web_url};
use crate::diff::crate_url;
use leptos::prelude::*;

#[component]
pub fn CrateCard(krate: Crate, #[prop(default = true)] show_external_links: bool) -> impl IntoView {
    let crate_link = crate_url(&krate.id);
    let documentation_url = krate.documentation_url();
    let repository_url = krate.repository.as_deref().and_then(safe_web_url);
    let downloads = format_downloads(krate.downloads);

    view! {
        <article class="card">
            <div class="card-heading">
                <h3><a href=crate_link>{krate.id}</a></h3>
                <span class="version">{krate.max_version}</span>
            </div>
            <p class="description">
                {krate.description.filter(|description| !description.trim().is_empty())
                    .unwrap_or_else(|| "No description provided.".to_owned())}
            </p>
            <div class="card-footer">
                <span class="downloads" title="Total downloads">
                    <span aria-hidden="true">"↓ "</span>{downloads}
                    <span class="sr-only">" total downloads"</span>
                </span>
                {show_external_links.then(|| view! { <div class="card-links">
                    <a href=documentation_url>"Docs ↗"</a>
                    {repository_url.map(|url| view! { <a href=url>"Source ↗"</a> })}
                </div> })}
            </div>
        </article>
    }
}
