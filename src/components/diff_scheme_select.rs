use crate::settings::{SettingsSnapshot, set_setting};
use leptos::prelude::*;

#[component]
pub fn DiffSchemeSelect(settings: ReadSignal<SettingsSnapshot>) -> impl IntoView {
    let dark = Memo::new(move |_| settings.read().resolved_mode == "dark");
    let selected = Memo::new(move |_| {
        settings.with(|settings| {
            if dark.get() {
                settings.dark_theme.clone()
            } else {
                settings.light_theme.clone()
            }
        })
    });
    view! {
        <label class="setting-field" for="settings-diff-theme">
            <span>{move || if dark.get() { "Dark diff scheme" } else { "Light diff scheme" }}</span>
            <select id="settings-diff-theme" prop:value=move || selected.get()
                on:change=move |event| {
                    let key = if dark.get_untracked() { "darkTheme" } else { "lightTheme" };
                    set_setting(key, &event_target_value(&event));
                }>
                <For
                    each=move || settings.with(|settings| {
                        if dark.get() { settings.dark_themes.clone() } else { settings.light_themes.clone() }
                    })
                    key=|theme| theme.id.clone()
                    children=move |theme| {
                        let id = theme.id.clone();
                        view! {
                            <option value=theme.id prop:selected=move || selected.get() == id>{theme.label}</option>
                        }
                    }
                />
            </select>
        </label>
    }
}
