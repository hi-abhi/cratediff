use super::{
    pierre::{Renderer, collapse_tree, mount_tree, update_tree},
    sidebar_toggle::SidebarToggle,
};
use crate::diff::{FileChange, FileStatus, comparison_url};
use leptos::{html, prelude::*};
use leptos_router::hooks::use_navigate;
use wasm_bindgen::{JsCast, closure::Closure};

#[component]
pub fn FileTree(
    name: String,
    old: String,
    new: String,
    files: Vec<FileChange>,
    selected: Memo<String>,
    sidebar_open: ReadSignal<bool>,
    toggle_sidebar: Callback<()>,
    hide_button: NodeRef<html::Button>,
    children: Children,
) -> impl IntoView {
    let files_json = serde_json::to_string(&files).expect("file changes serialize");
    let files_json = StoredValue::new(files_json);
    let navigate = use_navigate();
    let callback = Closure::<dyn FnMut(String)>::new(move |path: String| {
        navigate(
            &comparison_url(&name, &old, &new, &path),
            Default::default(),
        );
    });
    let callback = StoredValue::new_local(Some(callback));
    let renderer = StoredValue::new_local(None::<Renderer>);
    let host = NodeRef::<html::Div>::new();
    let (error, set_error) = signal(None::<String>);
    let (filter, set_filter) = signal(String::new());
    let (changed_only, set_changed_only) = signal(false);
    let (search_open, set_search_open) = signal(false);
    let search_input = NodeRef::<html::Input>::new();
    let search_button = NodeRef::<html::Button>::new();
    Effect::new(move |_| {
        if search_open.get()
            && let Some(input) = search_input.get()
        {
            let _ = input.focus();
        }
    });
    let filtered = Memo::new(move |_| {
        let filter = filter.get().trim().to_lowercase();
        files
            .iter()
            .filter(|file| {
                (!changed_only.get() || file.status != FileStatus::Unchanged)
                    && file.path.to_lowercase().contains(&filter)
            })
            .map(|file| file.path.clone())
            .collect::<Vec<_>>()
    });
    Effect::new(move |_| {
        let Some(host) = host.get() else { return };
        let selected = selected.get();
        let paths = serde_json::to_string(&filtered.get()).expect("paths serialize");
        renderer.update_value(|instance| {
            if instance.is_none() {
                let result = callback.with_value(|callback| {
                    mount_tree(
                        host.as_ref(),
                        &files_json.get_value(),
                        &selected,
                        callback.as_ref().unwrap().as_ref().unchecked_ref(),
                    )
                });
                match result {
                    Ok(value) => *instance = Some(Renderer(value)),
                    Err(error) => {
                        set_error.set(Some(format!("Unable to render the file tree: {error:?}")))
                    }
                }
            }
            if let Some(instance) = instance {
                update_tree(&instance.0, &paths, &selected);
            }
        });
    });
    on_cleanup(move || {
        renderer.update_value(|instance| {
            instance.take();
        });
        callback.update_value(|callback| {
            callback.take();
        });
    });
    view! {
        <aside id="file-sidebar" class="file-sidebar" hidden=move || !sidebar_open.get()>
            <div class="file-sidebar-header">
                <h2>"Files"</h2>
                <div class="tree-actions" role="group" aria-label="File tree tools">
                    <button class="tree-action" type="button" node_ref=search_button
                        aria-label="Search files" title="Search files"
                        aria-controls="file-filter"
                        aria-expanded=move || if search_open.get() { "true" } else { "false" }
                        aria-pressed=move || if search_open.get() { "true" } else { "false" }
                        on:click=move |_| {
                            let open = !search_open.get_untracked();
                            set_search_open.set(open);
                            if !open { set_filter.set(String::new()); }
                        }>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="10.5" cy="10.5" r="6.5"/>
                            <path d="m16 16 4 4"/>
                        </svg>
                    </button>
                    <button class="tree-action" type="button"
                        aria-label="Changed files only" title="Show changed files only"
                        aria-pressed=move || if changed_only.get() { "true" } else { "false" }
                        on:click=move |_| set_changed_only.update(|value| *value = !*value)>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 12h6M11 9v6M8 18h6"/>
                        </svg>
                    </button>
                    <button class="tree-action" type="button"
                        aria-label="Collapse folders" title="Collapse all folders"
                        on:click=move |_| renderer.with_value(|instance| {
                            if let Some(instance) = instance { collapse_tree(&instance.0); }
                        })>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 3H3v13M8 8h13v13H8zM11 14.5h7"/>
                        </svg>
                    </button>
                    <SidebarToggle open=sidebar_open toggle=toggle_sidebar button_ref=hide_button/>
                </div>
            </div>
            <Show when=move || search_open.get()>
                <label class="sr-only" for="file-filter">"Search files"</label>
                <input id="file-filter" type="search" placeholder="Search files" node_ref=search_input
                    prop:value=move || filter.get()
                    on:input=move |event| set_filter.set(event_target_value(&event))
                    on:keydown=move |event| {
                        if event.key() == "Escape" {
                            event.prevent_default();
                            set_filter.set(String::new());
                            set_search_open.set(false);
                            if let Some(button) = search_button.get_untracked() { let _ = button.focus(); }
                        }
                    }/>
            </Show>
            <div class="file-tree-host" node_ref=host aria-label="Crate files"/>
            <Show when=move || filtered.get().is_empty()>
                <p class="empty">"No files match these filters."</p>
            </Show>
            {move || error.get().map(|message| view! { <p role="alert">{message}</p> })}
            {children()}
        </aside>
    }
}
