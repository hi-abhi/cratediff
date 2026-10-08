use super::{
    diff_context_toggle::DiffContextToggle,
    diff_layout_toggle::DiffLayoutToggle,
    pierre::{Renderer, mount_diff, update_diff},
};
use crate::{
    components::problem::Problem,
    diff::{Files, LoadError, text},
};
use leptos::{html, prelude::*};
use std::sync::Arc;

#[component]
pub fn FilePanel(path: String, old_files: Arc<Files>, new_files: Arc<Files>) -> impl IntoView {
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
    let (all_lines, set_all_lines) = signal(identical);
    let (split, set_split) = signal(false);
    Effect::new(move |_| {
        let Some(host) = host.get() else { return };
        let split = split.get();
        let all_lines = all_lines.get();
        renderer.update_value(|instance| {
            if instance.is_none() && !empty {
                let (path, old, new) = source.get_value();
                match mount_diff(host.as_ref(), &path, old, new, identical) {
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
            instance.take();
        })
    });
    view! {
        <section class="diff-view" aria-label="File comparison">
            <div class="diff-heading">
                <h2>{path}</h2>
                <div class="diff-options">
                    <DiffContextToggle expanded=all_lines
                        on_toggle=Callback::new(move |()| set_all_lines.update(|value| *value = !*value))/>
                    <DiffLayoutToggle split=split
                        on_select=Callback::new(move |value| set_split.set(value))/>
                </div>
            </div>
            {identical.then(|| view! { <p class="file-notice">"This file is unchanged."</p> })}
            {empty.then(|| view! { <p class="file-notice">"This file is empty."</p> })}
            <div class="pierre-diff-host" node_ref=host aria-label="Source diff"/>
            {move || error.get().map(|message| view! { <p class="file-notice" role="alert">{message}</p> })}
        </section>
    }.into_any()
}
