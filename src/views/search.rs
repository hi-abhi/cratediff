use crate::{
    components::{page_title::PageTitle, search_form::SearchForm, search_results::SearchResults},
    search::{fetch_search, search_url},
    views::not_found::NotFound,
};
use leptos::prelude::*;
use leptos_router::{
    NavigateOptions,
    hooks::{use_navigate, use_params_map, use_query_map},
};
use std::time::Duration;

#[component]
pub fn SearchPage() -> impl IntoView {
    let params = use_params_map();
    let query_params = use_query_map();
    let query = Memo::new(move |_| {
        params
            .read()
            .get("query")
            .unwrap_or_default()
            .trim()
            .to_owned()
    });
    let page = Memo::new(move |_| {
        query_params
            .read()
            .get("page")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|page| *page > 0)
            .unwrap_or(1)
    });
    let (draft, set_draft) = signal(query.get_untracked());
    let timer = StoredValue::new_local(None::<TimeoutHandle>);
    let cancel = move || {
        timer.update_value(|timer| {
            if let Some(timer) = timer.take() {
                timer.clear();
            }
        })
    };
    Effect::new(move |_| {
        set_draft.set(query.get());
        cancel();
    });
    on_cleanup(cancel);
    let navigate = use_navigate();
    let search = Callback::new(move |(query, replace): (String, bool)| {
        navigate(
            &search_url(&query, 1),
            NavigateOptions {
                replace,
                scroll: false,
                ..Default::default()
            },
        );
    });
    let on_input = Callback::new(move |value: String| {
        set_draft.set(value.clone());
        cancel();
        if let Ok(handle) = set_timeout_with_handle(
            move || search.run((value, true)),
            Duration::from_millis(500),
        ) {
            timer.set_value(Some(handle));
        }
    });
    let on_search = Callback::new(move |value: String| {
        cancel();
        search.run((value, false));
    });
    let (retry, set_retry) = signal(0_u64);
    // Each response carries its request identity, so an older request cannot
    // display results under a newer query or page while navigation is pending.
    let results = LocalResource::new(move || {
        retry.get();
        let query = query.get();
        let page = page.get();
        async move {
            let response = if query.is_empty() {
                None
            } else {
                Some(fetch_search(&query, page).await)
            };
            (query, page, response)
        }
    });
    view! {
        <Show when=move || !query.get().is_empty() fallback=NotFound>
        <div class="search-page">
            <PageTitle/>
            <section class="hero" aria-labelledby="search-title">
                <h1 id="search-title">"Compare diffs for Rust crate versions"</h1>
                <p class="intro">"Search by crate name or keyword, then compare its published releases."</p>
                <SearchForm query=draft.into() on_input=on_input on_search=on_search id="crate-search"/>
                <p class="search-note">"Live results from crates.io · Search updates as you type"</p>
            </section>
            <Suspense fallback=|| view! { <div class="status" role="status">"Searching crates.io"</div> }>
                {move || results.get().map(|(requested_query, requested_page, response)| {
                    if requested_query != query.get() || requested_page != page.get() {
                        return view! { <div class="status" role="status">"Searching crates.io"</div> }.into_any();
                    }
                    match response {
                        None => ().into_any(),
                        Some(Ok(response)) => view! { <SearchResults query=requested_query page=requested_page response=response/> }.into_any(),
                        Some(Err(message)) => view! {
                            <div class="status error" role="alert">
                                <h2>"Unable to search crates"</h2><p>{message}</p>
                                <button on:click=move |_| set_retry.update(|value| *value += 1)>"Try again"</button>
                            </div>
                        }.into_any(),
                    }
                })}
            </Suspense>
        </div>
        </Show>
    }
}
