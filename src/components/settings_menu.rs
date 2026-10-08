use super::diff_scheme_select::DiffSchemeSelect;
use crate::settings::*;
use leptos::{html, prelude::*};

#[component]
pub fn SettingsMenu() -> impl IntoView {
    let settings = use_settings();
    let dialog = NodeRef::<html::Dialog>::new();
    let (custom, set_custom) = signal(String::new());
    let (custom_font, set_custom_font) = signal(false);
    on_cleanup(move || preview_font(None));
    let close = move || {
        if let Some(dialog) = dialog.get_untracked() {
            close_settings(dialog.as_ref());
        }
    };
    view! {
        <button class="settings-trigger" type="button" aria-label="Settings" title="Settings"
            aria-haspopup="dialog" aria-controls="settings-dialog"
            on:click=move |_| {
                set_custom_font.set(false);
                set_custom.set(String::new());
                if let Some(dialog) = dialog.get_untracked() {
                    open_settings(dialog.as_ref());
                }
            }>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9.5 3-.6 2.1-1.5.9-2.1-.5-2.5 4.3 1.5 1.6v1.7l-1.5 1.6 2.5 4.3 2.1-.5 1.5.9.6 2.1h5l.6-2.1 1.5-.9 2.1.5 2.5-4.3-1.5-1.6v-1.7l1.5-1.6-2.5-4.3-2.1.5-1.5-.9-.6-2.1z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        </button>
        <dialog id="settings-dialog" class="settings-dialog" node_ref=dialog aria-labelledby="settings-title"
            on:close=move |_| { preview_font(None); set_custom_font.set(false); }
            on:click=move |event| {
                if let Some(dialog) = dialog.get_untracked() {
                    let rect = dialog.get_bounding_client_rect();
                    let x = f64::from(event.client_x());
                    let y = f64::from(event.client_y());
                    if x < rect.left() || x > rect.right() || y < rect.top() || y > rect.bottom() {
                        close();
                    }
                }
            }>
            <div class="settings-heading">
                <h2 id="settings-title">"Settings"</h2>
                <button class="settings-close" type="button" aria-label="Close settings"
                    on:click=move |_| close()>"×"</button>
            </div>
            <div class="settings-body">
                <div class="setting-field">
                    <span id="settings-appearance-label">"Appearance"</span>
                    <div class="setting-buttons" role="group" aria-labelledby="settings-appearance-label">
                        {[
                            ("auto", "Auto"),
                            ("light", "Light"),
                            ("dark", "Dark"),
                        ].into_iter().map(|(value, label)| view! {
                            <button type="button" aria-pressed=move || if settings.get().mode == value { "true" } else { "false" }
                                title=if value == "auto" { "Follow your system appearance" } else { label }
                                on:click=move |_| set_setting("mode", value)>{label}</button>
                        }).collect_view()}
                    </div>
                </div>
                <label class="setting-field" for="settings-font-size">
                    <span>"Diff font size"</span>
                    <select id="settings-font-size" prop:value=move || settings.get().font_size.to_string()
                        on:change=move |event| set_setting("fontSize", &event_target_value(&event))>
                        {settings.get_untracked().font_sizes.into_iter().map(|size| view! {
                            <option value=size.to_string()>{format!("{size} px")}</option>
                        }).collect_view()}
                    </select>
                </label>
                <div class="setting-field">
                    <span id="settings-code-width-label">"Workspace layout"</span>
                    <div class="setting-buttons" role="group" aria-labelledby="settings-code-width-label">
                        {[("standard", "Standard"), ("fullscreen", "Full screen")].into_iter().map(|(value, label)| view! {
                            <button type="button" aria-pressed=move || if settings.get().code_width == value { "true" } else { "false" }
                                on:click=move |_| set_setting("codeWidth", value)>{label}</button>
                        }).collect_view()}
                    </div>
                </div>
                <DiffSchemeSelect settings=settings/>
                <label class="setting-field" for="settings-mono-font">
                    <span>"Monospace font"</span>
                    <select id="settings-mono-font"
                        prop:value=move || if custom_font.get() { "__custom".to_owned() } else { settings.get().mono_font }
                        on:change=move |event| {
                            let value = event_target_value(&event);
                            let is_custom = value == "__custom";
                            set_custom_font.set(is_custom);
                            preview_font(None);
                            if !is_custom { set_setting("monoFont", &value); }
                        }>
                        <For each=move || settings.get().fonts key=|font| font.clone() children=|font| view! {
                            <option value=font.clone()>{font.clone()}</option>
                        }/>
                        <option value="__custom">"Custom font"</option>
                    </select>
                </label>
                <Show when=move || custom_font.get()>
                    <form class="custom-font" on:submit=move |event| {
                        event.prevent_default();
                        let font = custom.get_untracked().trim().to_owned();
                        if !font.is_empty() {
                            set_setting("monoFont", &font);
                            set_custom_font.set(false);
                        }
                    }>
                        <label class="sr-only" for="settings-custom-font">"Custom font family"</label>
                        <input id="settings-custom-font" placeholder="Installed font family" maxlength="200"
                            prop:value=move || custom.get()
                            on:input=move |event| {
                                let value = event_target_value(&event);
                                set_custom.set(value.clone());
                                preview_font(Some(value));
                            }/>
                        <button class="button secondary" type="submit">"Apply"</button>
                    </form>
                </Show>
                <div class="font-discovery">
                    <button class="button secondary" type="button"
                        aria-describedby="settings-font-discovery-note"
                        disabled=move || settings.get().detecting
                        on:click=move |_| detect_fonts()>
                        {move || if settings.get().detecting { "Finding fonts" } else { "Find installed fonts" }}
                    </button>
                    <p id="settings-font-discovery-note">
                        "Fonts use your device's installed families, with system fallbacks. Full font discovery requires browser support for the "
                        <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts"
                            target="_blank" rel="noopener noreferrer">"Local Font Access API"</a>"."
                    </p>
                </div>
                <div class="font-preview" aria-label="Monospace font preview"><code>"fn main() { println!(\"Hello, Rust!\"); }"</code></div>
            </div>
            <div class="settings-footer">
                <button class="text-button" type="button" on:click=move |_| {
                    set_custom_font.set(false);
                    reset_settings();
                }>"Reset to defaults"</button>
                <button class="button" type="button" on:click=move |_| close()>"Done"</button>
            </div>
        </dialog>
    }
}
