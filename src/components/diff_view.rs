use super::pierre::{Renderer, diff_scroll_position, mount_diff, update_diff};
use crate::{
    components::problem::Problem,
    diff::{Files, LoadError, text},
};
use leptos::{html, prelude::*};
use std::{collections::HashMap, sync::Arc};

/// Scroll offsets (top, left) per file path, kept for the lifetime of a comparison.
pub type ScrollPositions = StoredValue<HashMap<String, (i32, i32)>>;

#[component]
pub fn FilePanel(
    path: String,
    old_files: Arc<Files>,
    new_files: Arc<Files>,
    all_lines: ReadSignal<bool>,
    split: Memo<bool>,
    scroll_positions: ScrollPositions,
) -> impl IntoView {
    let old = old_files.get(&path);
    let new = new_files.get(&path);
    if old.is_none() && new.is_none() {
        return view! { <Problem error=LoadError::NotFound(format!("The file “{path}” does not exist in either version."))/> }.into_any();
    }
    let (Some(old_text), Some(new_text)) = (
        text(old.map(Vec::as_slice).unwrap_or_default()),
        text(new.map(Vec::as_slice).unwrap_or_default()),
    ) else {
        return view! {
            <div class="status"><h2>{path}</h2>
                <p>"Binary or non-UTF-8 file. A text comparison is unavailable."</p>
                <p>{format!("Old: {} bytes · New: {} bytes", old.map_or(0, Vec::len), new.map_or(0, Vec::len))}</p>
            </div>
        }.into_any();
    };
    let identical = old == new;
    let empty = old_text.is_empty() && new_text.is_empty();
    let source = StoredValue::new((
        path.clone(),
        old.map(|_| old_text.to_owned()),
        new.map(|_| new_text.to_owned()),
    ));
    let renderer = StoredValue::new_local(None::<Renderer>);
    let host = NodeRef::<html::Div>::new();
    let (error, set_error) = signal(None::<String>);
    Effect::new(move |_| {
        let Some(host) = host.get() else { return };
        let split = split.get();
        let all_lines = all_lines.get();
        renderer.update_value(|instance| {
            if instance.is_none() && !empty {
                let (path, old, new) = source.get_value();
                // Leptos reuses this host across files; Pierre restores the
                // file's saved offset, or the top for a file not yet viewed.
                let (top, left) = scroll_positions
                    .with_value(|positions| positions.get(&path).copied())
                    .unwrap_or_default();
                match mount_diff(host.as_ref(), &path, old, new, identical, top, left) {
                    Ok(value) => *instance = Some(Renderer(value)),
                    Err(error) => {
                        set_error.set(Some(format!("Unable to render this diff: {error:?}")))
                    }
                }
            }
            if let Some(instance) = instance {
                update_diff(&instance.0, split, all_lines);
            }
        });
    });
    on_cleanup(move || {
        renderer.update_value(|instance| {
            let Some(instance) = instance.take() else {
                return;
            };
            if let [top, left] = diff_scroll_position(&instance.0)[..] {
                source.with_value(|(path, ..)| {
                    scroll_positions.update_value(|positions| {
                        positions.insert(path.clone(), (top, left));
                    })
                });
            }
        })
    });
    view! {
        <section class="diff-view" aria-label="File comparison">
            <div class="diff-heading">
                <h2>{path}</h2>
            </div>
            {identical.then(|| view! { <p class="file-notice">"This file is unchanged."</p> })}
            {empty.then(|| view! { <p class="file-notice">"This file is empty."</p> })}
            <div class="pierre-diff-host" node_ref=host aria-label="Source diff"/>
            {move || error.get().map(|message| view! { <p class="file-notice" role="alert">{message}</p> })}
        </section>
    }.into_any()
}
