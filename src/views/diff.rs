use crate::{
    components::{
        comparison_header::ComparisonHeader, diff_workspace::DiffWorkspace, page_title::PageTitle,
        problem::Problem,
    },
    diff::{Comparison, CrateResponse, LoadError, comparison_url, fetch_crate, fetch_source},
};
use leptos::prelude::*;
use leptos_router::{NavigateOptions, components::Redirect, hooks::use_params_map};

#[component]
pub fn DiffPage() -> impl IntoView {
    let params = use_params_map();
    let name = Memo::new(move |_| params.read().get("krate").unwrap_or_default());
    let (retry, set_retry) = signal(0_u64);
    let metadata = LocalResource::new(move || {
        retry.get();
        let name = name.get();
        async move { fetch_crate(&name).await }
    });
    view! {
        <div class="comparison-page">
            <PageTitle text=Signal::derive(move || format!("{} - Crate Diff", name.get()))/>
            <Suspense fallback=|| view! { <div class="status" role="status">"Loading crate metadata"</div> }>
                {move || metadata.get().map(|result| match result {
                    Ok(metadata) if params.read_untracked().get("old").is_none() => {
                        match (metadata.resolve("previous"), metadata.resolve("latest")) {
                            (Ok(old), Ok(new)) => view! {
                                <Redirect path=comparison_url(&metadata.krate.id, &old.num, &new.num, "")
                                    options=NavigateOptions { replace: true, ..Default::default() }/>
                            }.into_any(),
                            (Err(error), _) | (_, Err(error)) => view! { <Problem error=error/> }.into_any(),
                        }
                    },
                    Ok(metadata) => view! { <CrateComparison metadata=metadata/> }.into_any(),
                    Err(error) => view! { <Problem error=error retry=set_retry/> }.into_any(),
                })}
            </Suspense>
        </div>
    }
}

#[component]
fn CrateComparison(metadata: CrateResponse) -> impl IntoView {
    let params = use_params_map();
    let metadata = StoredValue::new(metadata);
    let versions = Memo::new(move |_| {
        let params = params.read();
        metadata.with_value(|metadata| {
            Ok::<_, LoadError>((
                metadata.resolve(&params.get("old").unwrap_or_else(|| "previous".into()))?,
                metadata.resolve(&params.get("new").unwrap_or_else(|| "latest".into()))?,
            ))
        })
    });
    let (retry, set_retry) = signal(0_u64);
    let (sidebar_open, set_sidebar_open) = signal(true);
    let toggle_sidebar = Callback::new(move |()| set_sidebar_open.update(|open| *open = !*open));
    let sources = LocalResource::new(move || {
        retry.get();
        let versions = versions.get();
        let name = metadata.with_value(|metadata| metadata.krate.id.clone());
        async move {
            let (old, new) = versions?;
            let (old_files, new_files) = if old == new {
                let files = fetch_source(&name, &old).await?;
                (files.clone(), files)
            } else {
                let (old_files, new_files) =
                    futures::join!(fetch_source(&name, &old), fetch_source(&name, &new));
                (old_files?, new_files?)
            };
            Ok::<_, LoadError>(Comparison {
                old,
                new,
                old_files,
                new_files,
            })
        }
    });
    view! {
        <ComparisonHeader metadata=metadata.get_value() versions=versions/>
        {move || versions.get().err().map(|error| view! { <Problem error=error/> })}
        <Suspense fallback=|| view! {
            <div class="status" role="status">"Downloading and comparing crate source"</div>
        }>
            {move || sources.get().map(|result| match result {
                Ok(comparison) => view! {
                    <DiffWorkspace
                        name=metadata.with_value(|metadata| metadata.krate.id.clone())
                        comparison=comparison
                        sidebar_open=sidebar_open toggle_sidebar=toggle_sidebar
                    />
                }.into_any(),
                Err(error) if versions.get().is_ok() => view! { <Problem error=error retry=set_retry/> }.into_any(),
                Err(_) => ().into_any(),
            })}
        </Suspense>
    }
}
