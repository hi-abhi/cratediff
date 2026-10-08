use crate::diff::{VersionInfo, comparison_url};
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
    let navigate = use_navigate();
    let name = StoredValue::new(name);
    let old = StoredValue::new(old);
    let new = StoredValue::new(new);
    let navigate_old = navigate.clone();
    let navigate_new = navigate;
    let old_options = versions.clone();

    view! {
        <div class="version-controls" role="group" aria-label="Compared versions">
            <label for="old-version"><span>"From"</span>
                <select id="old-version" prop:value=old.get_value()
                    on:change=move |event| {
                        navigate_old(&comparison_url(&name.get_value(), &event_target_value(&event), &new.get_value(),
                            &params.read().get("file").unwrap_or_default()), Default::default());
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
                        navigate_new(&comparison_url(&name.get_value(), &old.get_value(), &event_target_value(&event),
                            &params.read().get("file").unwrap_or_default()), Default::default());
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
