use crate::diff::LoadError;
use leptos::prelude::*;

#[component]
pub fn Problem(
    error: LoadError,
    #[prop(optional)] retry: Option<WriteSignal<u64>>,
) -> impl IntoView {
    let missing = matches!(error, LoadError::NotFound(_));
    view! {
        <div class="status error" role="alert">
            <h2>{if missing { "Not found" } else { "Unable to load comparison" }}</h2>
            <p>{error.to_string()}</p>
            <div class="problem-actions">
                {retry.filter(|_| !missing).map(|retry| view! {
                    <button on:click=move |_| retry.update(|value| *value += 1)>"Try again"</button>
                })}
                <a class="button secondary" href="/">"Back to home"</a>
            </div>
        </div>
    }
}
