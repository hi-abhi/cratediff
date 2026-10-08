use crate::{
    components::crate_card::CrateCard,
    data::{Crate, Summary},
};
use leptos::prelude::*;

#[component]
pub fn SummaryLists(summary: Summary) -> impl IntoView {
    view! {
        <div class="summary">
            <CrateColumn
                title="Most Downloaded"
                crates=summary.most_downloaded
            />
            <CrateColumn
                title="Just Updated"
                crates=summary.just_updated
            />
        </div>
    }
}

#[component]
fn CrateColumn(title: &'static str, crates: Vec<Crate>) -> impl IntoView {
    let empty = crates.is_empty();

    view! {
        <section class="column" aria-label=title>
            <div class="column-heading">
                <h2>{title}</h2>
            </div>
            <div class="cards">
                {crates.into_iter().map(|krate| view! { <CrateCard krate=krate show_external_links=false/> }).collect_view()}
                {empty.then(|| view! { <p class="empty">"No crates available."</p> })}
            </div>
        </section>
    }
}
