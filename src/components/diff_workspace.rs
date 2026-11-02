use crate::{
    components::{
        change_review::ChangeReview, diff_toolbar::DiffToolbar, diff_view::FilePanel,
        file_tree::FileTree, sidebar_toggle::SidebarToggle,
    },
    diff::{Comparison, FileStatus, file_changes},
    review::{scoped_changes, use_review_scope, view_url},
    settings::use_settings,
};
use leptos::{html, prelude::*};
use leptos_router::hooks::{use_navigate, use_params_map};

#[component]
pub fn DiffWorkspace(
    name: String,
    comparison: Comparison,
    sidebar_open: ReadSignal<bool>,
    toggle_sidebar: Callback<()>,
) -> impl IntoView {
    let params = use_params_map();
    let scope = use_review_scope();
    let route_file = Memo::new(move |_| params.read().get("file").unwrap_or_default());
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
        let file = route_file.get();
        if !file.is_empty() {
            return file;
        }
        changes.with_value(|files| {
            files
                .iter()
                .find(|file| file.path == "Cargo.toml")
                .or_else(|| files.first())
                .map(|file| file.path.clone())
                .unwrap_or_default()
        })
    });
    let tree_selected = Memo::new(move |_| {
        let file = route_file.get();
        if file.is_empty() {
            scope.get().unwrap_or_else(|| selected.get())
        } else {
            file
        }
    });
    let full_diff = Memo::new(move |_| scope.get().is_some());
    let scoped = Memo::new(move |_| {
        changes.with_value(|files| scoped_changes(files, &scope.get().unwrap_or_default()))
    });
    let settings = use_settings();
    let split = Memo::new(move |_| settings.with(|settings| settings.diff_layout == "split"));
    let (all_lines, set_all_lines) = signal(false);
    let identity = StoredValue::new(name.clone());
    let navigate = use_navigate();
    let toggle_full_diff = Callback::new(move |()| {
        let path = selected.get_untracked();
        let url = comparison.with_value(|comparison| {
            let name = identity.get_value();
            let old = &comparison.old.num;
            let new = &comparison.new.num;
            view_url(
                &name,
                old,
                new,
                &path,
                (!full_diff.get_untracked()).then_some(""),
            )
        });
        navigate(&url, Default::default());
    });

    view! {
        <div class="diff-workspace" class:sidebar-collapsed=move || !sidebar_open.get()>
            <FileTree name=name
                old=comparison.with_value(|comparison| comparison.old.num.clone())
                new=comparison.with_value(|comparison| comparison.new.num.clone())
                files=changes.get_value() selected=tree_selected
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
                <DiffToolbar full_diff=full_diff toggle_full_diff=toggle_full_diff
                    all_lines=all_lines split=split
                    toggle_all_lines=Callback::new(move |()| set_all_lines.update(|value| *value = !*value))>
                    <Show when=move || full_diff.get()>
                        <span class="review-totals" aria-label="Review summary">
                            {move || {
                                let count = scoped.read().len();
                                format!("{count} {}", if count == 1 { "file" } else { "files" })
                            }}
                            <span class="added">{move || format!("+{}", scoped.read().iter().map(|file| file.added).sum::<usize>())}</span>
                            <span class="removed">{move || format!("−{}", scoped.read().iter().map(|file| file.removed).sum::<usize>())}</span>
                        </span>
                    </Show>
                </DiffToolbar>
                <Show when=move || full_diff.get() fallback=move || view! {
                    {move || comparison.with_value(|comparison| view! {
                        <FilePanel path=selected.get() old_files=comparison.old_files.clone() new_files=comparison.new_files.clone()
                            all_lines=all_lines split=split/>
                    })}
                }>
                    <ChangeReview files=scoped selected=route_file
                        old_files=comparison.with_value(|comparison| comparison.old_files.clone())
                        new_files=comparison.with_value(|comparison| comparison.new_files.clone())
                        scope=scope all_lines=all_lines split=split/>
                </Show>
            </div>
        </div>
    }
}
