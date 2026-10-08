use crate::{
    components::{diff_view::FilePanel, file_tree::FileTree, sidebar_toggle::SidebarToggle},
    diff::{Comparison, FileStatus, file_changes},
};
use leptos::{html, prelude::*};
use leptos_router::hooks::use_params_map;

#[component]
pub fn DiffWorkspace(
    name: String,
    comparison: Comparison,
    sidebar_open: ReadSignal<bool>,
    toggle_sidebar: Callback<()>,
) -> impl IntoView {
    let params = use_params_map();
    let changes = file_changes(&comparison.old_files, &comparison.new_files);
    let changed_count = changes
        .iter()
        .filter(|file| file.status != FileStatus::Unchanged)
        .count();
    let added: usize = changes.iter().map(|file| file.added).sum();
    let removed: usize = changes.iter().map(|file| file.removed).sum();
    let changes = StoredValue::new(changes);
    let comparison = StoredValue::new(comparison);
    let hide_button = NodeRef::<html::Button>::new();
    let show_button = NodeRef::<html::Button>::new();
    let previous_open = StoredValue::new(sidebar_open.get_untracked());
    Effect::new(move |_| {
        let open = sidebar_open.get();
        if previous_open.get_value() != open {
            previous_open.set_value(open);
            let button = if open { hide_button } else { show_button };
            if let Some(button) = button.get_untracked() {
                let _ = button.focus();
            }
        }
    });
    let selected = Memo::new(move |_| {
        params
            .read()
            .get("file")
            .filter(|file| !file.is_empty())
            .unwrap_or_else(|| {
                changes.with_value(|files| {
                    files
                        .iter()
                        .find(|file| file.path == "Cargo.toml")
                        .or_else(|| files.first())
                        .map(|file| file.path.clone())
                        .unwrap_or_default()
                })
            })
    });

    view! {
        <div class="diff-workspace" class:sidebar-collapsed=move || !sidebar_open.get()>
            <FileTree name=name
                old=comparison.with_value(|comparison| comparison.old.num.clone())
                new=comparison.with_value(|comparison| comparison.new.num.clone())
                files=changes.get_value() selected=selected
                sidebar_open=sidebar_open toggle_sidebar=toggle_sidebar hide_button=hide_button>
                <div class="comparison-summary" aria-label="Comparison summary">
                    <span>{format!("{changed_count} changed files")}</span>
                    <span class="added">{format!("+{added}")}</span>
                    <span class="removed">{format!("−{removed}")}</span>
                    <span class="muted">"lines"</span>
                </div>
            </FileTree>
            <div class="sidebar-rail" hidden=move || sidebar_open.get()>
                <SidebarToggle open=sidebar_open toggle=toggle_sidebar button_ref=show_button/>
            </div>
            <div class="file-panel">
                {move || {
                    let path = selected.get();
                    comparison.with_value(|comparison| {
                        view! { <FilePanel path=path old_files=comparison.old_files.clone() new_files=comparison.new_files.clone()/> }
                    })
                }}
            </div>
        </div>
    }
}
