use crate::diff::VersionInfo;
use crate::review::{use_review_scope, view_url};
use leptos::prelude::*;
use leptos_router::hooks::{use_navigate, use_params_map};

#[component]
pub fn VersionControls(
    name: String,
    versions: Vec<VersionInfo>,
    old: String,
    new: String,
) -> impl IntoView {
    let params = use_params_map();
    let scope = use_review_scope();
    let navigate = use_navigate();
    let name = StoredValue::new(name);
    let old = StoredValue::new(old);
    let new = StoredValue::new(new);
    let change_version = Callback::new(move |(old, new): (String, String)| {
        let file = params.read_untracked().get("file").unwrap_or_default();
        let url = view_url(
            &name.get_value(),
            &old,
            &new,
            &file,
            scope.get_untracked().as_deref(),
        );
        navigate(&url, Default::default());
    });
    let old_options = versions.clone();

    view! {
        <div class="version-controls" role="group" aria-label="Compared versions">
            <label for="old-version"><span>"From"</span>
                <select id="old-version" prop:value=old.get_value()
                    on:change=move |event| {
                        change_version.run((event_target_value(&event), new.get_value()));
                    }>
                    {old_options.into_iter().map(|version| view! {
                        <option value=version.num.clone() selected=version.num == old.get_value()>
                            {format!("{}{}", version.num, if version.yanked { " (yanked)" } else { "" })}
                        </option>
                    }).collect_view()}
                </select>
            </label>
            <label for="new-version"><span>"To"</span>
                <select id="new-version" prop:value=new.get_value()
                    on:change=move |event| {
                        change_version.run((old.get_value(), event_target_value(&event)));
                    }>
                    {versions.into_iter().map(|version| view! {
                        <option value=version.num.clone() selected=version.num == new.get_value()>
                            {format!("{}{}", version.num, if version.yanked { " (yanked)" } else { "" })}
                        </option>
                    }).collect_view()}
                </select>
            </label>
        </div>
    }
}
