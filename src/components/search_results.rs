use super::crate_card::CrateCard;
use crate::{
    data::format_downloads,
    search::{PAGE_SIZE, SearchResponse, search_url},
};
use leptos::prelude::*;

#[component]
pub fn SearchResults(query: String, page: u64, response: SearchResponse) -> impl IntoView {
    let total = response.meta.total;
    let count = response.crates.len() as u64;
    let start = page
        .saturating_sub(1)
        .saturating_mul(PAGE_SIZE)
        .saturating_add(1);
    let end = start.saturating_add(count).saturating_sub(1);
    let pages = total.div_ceil(PAGE_SIZE).max(1);
    let first_url = search_url(&query, 1);
    let previous_url = (page > 1).then(|| search_url(&query, page - 1));
    let next_url = (count > 0 && page < pages).then(|| search_url(&query, page + 1));
    view! {
        <section class="search-results" aria-label="Search results">
            <div class="results-heading" role="status">
                <h2>{format!("Results for “{query}”")}</h2>
                <p>{if count == 0 {
                    format!("{} matching crates", format_downloads(total))
                } else {
                    format!("{}–{} of {} matching crates", format_downloads(start), format_downloads(end), format_downloads(total))
                }}</p>
            </div>
            {if count == 0 {
                view! {
                    <div class="status">
                        <h3>{if total == 0 { "No crates found" } else { "No results on this page" }}</h3>
                        <p>{if total == 0 { "Try another crate name or keyword." } else { "Return to the first page to browse the matching crates." }}</p>
                        {(total > 0).then(|| view! { <a class="button secondary" href=first_url>"First page"</a> })}
                    </div>
                }.into_any()
            } else {
                view! {
                    <div class="cards">
                        {response.crates.into_iter().map(|krate| view! { <CrateCard krate=krate/> }).collect_view()}
                    </div>
                }.into_any()
            }}
            {(total > 0).then(|| view! {
                <nav class="pagination" aria-label="Search result pages">
                    {previous_url.map(|url| view! { <a class="button secondary" href=url rel="prev">"Previous"</a> })}
                    <span>{format!("Page {page} of {pages}")}</span>
                    {next_url.map(|url| view! { <a class="button secondary" href=url rel="next">"Next"</a> })}
                </nav>
            })}
        </section>
    }
}
