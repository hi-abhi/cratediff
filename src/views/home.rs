use crate::{
    components::{crate_summary::SummaryLists, page_title::PageTitle, search_form::SearchForm},
    data::fetch_summary,
    search::search_url,
};
use leptos::prelude::*;
use leptos_router::hooks::use_navigate;

#[component]
pub fn Home() -> impl IntoView {
    let (query, set_query) = signal(String::new());
    let navigate = use_navigate();
    let on_search = Callback::new(move |query: String| {
        navigate(&search_url(&query, 1), Default::default());
    });
    let (reload, set_reload) = signal(0_u64);
    let summary = LocalResource::new(move || {
        reload.get();
        fetch_summary()
    });

    view! {
        <div class="home-page">
                <PageTitle/>
                <section class="hero" aria-labelledby="page-title">
                    <h1 id="page-title">"View diffs for Rust crates."</h1>
                    <SearchForm query=query.into()
                        on_input=Callback::new(move |value| set_query.set(value))
                        on_search=on_search id="home-search" show_button=false/>
                </section>

                <Suspense fallback=|| view! {
                    <div class="status" role="status">"Loading crates from crates.io"</div>
                }>
                    {move || summary.get().map(|result| match result {
                        Ok(data) => view! { <SummaryLists summary=data/> }.into_any(),
                        Err(message) => view! {
                            <div class="status error" role="alert">
                                <h2>"Unable to load crates"</h2>
                                <p>{message}</p>
                                <button on:click=move |_| set_reload.update(|value| *value += 1)>
                                    "Try again"
                                </button>
                            </div>
                        }.into_any(),
                    })}
                </Suspense>
        </div>
    }
}
