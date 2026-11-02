use super::pierre::{Renderer, mount_review, scroll_review, update_review};
use crate::diff::{FileChange, Files, text};
use leptos::{html, prelude::*};
use std::sync::Arc;

#[derive(serde::Serialize)]
struct ReviewFile {
    #[serde(flatten)]
    change: FileChange,
    old: Option<String>,
    new: Option<String>,
    notice: Option<String>,
}

#[component]
pub fn ChangeReview(
    files: Memo<Vec<FileChange>>,
    selected: Memo<String>,
    old_files: Arc<Files>,
    new_files: Arc<Files>,
    scope: Memo<Option<String>>,
    all_lines: ReadSignal<bool>,
    split: Memo<bool>,
) -> impl IntoView {
    let sources = StoredValue::new((old_files, new_files));
    let renderer = StoredValue::new_local(None::<Renderer>);
    let host = NodeRef::<html::Div>::new();
    let (error, set_error) = signal(None::<String>);
    let (generation, set_generation) = signal(0_u64);
    // Scope changes rebuild the list; file jumps retain the viewer and its scroll state.
    Effect::new(move |_| {
        let Some(host) = host.get() else { return };
        let files = files.get();
        let review = sources.with_value(|(old_files, new_files)| {
            files.into_iter().map(|change| {
                let old = old_files.get(&change.path);
                let new = new_files.get(&change.path);
                let before = text(old.map(Vec::as_slice).unwrap_or_default());
                let after = text(new.map(Vec::as_slice).unwrap_or_default());
                let notice = if before.is_none() || after.is_none() {
                    Some(format!("Binary or non-UTF-8 file. A text comparison is unavailable.\nOld: {} bytes · New: {} bytes",
                        old.map_or(0, Vec::len), new.map_or(0, Vec::len)))
                } else if before == Some("") && after == Some("") {
                    Some("This file is empty.".into())
                } else {
                    None
                };
                ReviewFile {
                    change,
                    old: old.and_then(|_| before.map(str::to_owned)),
                    new: new.and_then(|_| after.map(str::to_owned)),
                    notice,
                }
            }).collect::<Vec<_>>()
        });
        renderer.update_value(|instance| {
            instance.take();
            set_error.set(None);
            if !review.is_empty() {
                let json = serde_json::to_string(&review).expect("review files serialize");
                match mount_review(host.as_ref(), &json) {
                    Ok(value) => *instance = Some(Renderer(value)),
                    Err(error) => {
                        set_error.set(Some(format!("Unable to render these changes: {error:?}")))
                    }
                }
            }
        });
        set_generation.update(|generation| *generation += 1);
    });
    Effect::new(move |_| {
        // A new viewer receives current controls and the file jump after mounting.
        generation.get();
        let split = split.get();
        let all_lines = all_lines.get();
        renderer.with_value(|instance| {
            if let Some(instance) = instance {
                update_review(&instance.0, split, all_lines);
            }
        });
    });
    Effect::new(move |_| {
        generation.get();
        let selected = selected.get();
        renderer.with_value(|instance| {
            if let Some(instance) = instance {
                scroll_review(&instance.0, &selected);
            }
        });
    });
    on_cleanup(move || {
        renderer.update_value(|instance| {
            instance.take();
        })
    });
    view! {
        <section class="diff-view change-review" aria-label="Changes review">
            <Show when=move || files.read().is_empty()>
                <div class="review-empty" role="status">
                    <h3>"No changes"</h3>
                    <p>{move || if scope.get().unwrap_or_default().is_empty() {
                        "These crate versions contain the same files."
                    } else { "There are no changed files in this directory." }}</p>
                </div>
            </Show>
            <div class="pierre-review-host" node_ref=host aria-label="All file diffs"/>
            {move || error.get().map(|message| view! { <p class="file-notice" role="alert">{message}</p> })}
        </section>
    }
}
