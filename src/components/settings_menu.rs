use super::{about_content::AboutContent, diff_scheme_select::DiffSchemeSelect};
use crate::settings::*;
use leptos::{html, prelude::*};

#[component]
pub fn SettingsMenu() -> impl IntoView {
    let settings = use_settings();
    let dialog = NodeRef::<html::Dialog>::new();
    let settings_tab = NodeRef::<html::Button>::new();
    let about_tab = NodeRef::<html::Button>::new();
    let (about_open, set_about_open) = signal(false);
    let close = move || {
        if let Some(dialog) = dialog.get_untracked() {
            close_settings(dialog.as_ref());
        }
    };
    let select_tab = move |about: bool| {
        set_about_open.set(about);
        let tab = if about { about_tab } else { settings_tab };
        if let Some(tab) = tab.get_untracked() {
            let _ = tab.focus();
        }
    };
    view! {
        <button class="settings-trigger" type="button" aria-label="Settings" title="Settings and About"
            aria-haspopup="dialog" aria-controls="settings-dialog"
            on:click=move |_| {
                set_about_open.set(false);
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
        <dialog id="settings-dialog" class="settings-dialog" node_ref=dialog aria-label="Settings and About"
            on:click=move |event| {
                if let Some(dialog) = dialog.get_untracked() {
                    // Native dropdown clicks can bubble with coordinates outside
                    // the modal. Only the dialog itself can receive backdrop clicks.
                    if !event.target().is_some_and(|target| {
                        js_sys::Object::is(target.as_ref(), dialog.as_ref())
                    }) {
                        return;
                    }
                    let rect = dialog.get_bounding_client_rect();
                    let x = f64::from(event.client_x());
                    let y = f64::from(event.client_y());
                    if x < rect.left() || x > rect.right() || y < rect.top() || y > rect.bottom() {
                        close();
                    }
                }
            }>
            <div class="settings-heading">
                <div class="settings-tabs" role="tablist" aria-label="Settings and About"
                    on:keydown=move |event| {
                        let next = match event.key().as_str() {
                            "ArrowLeft" | "ArrowRight" => !about_open.get_untracked(),
                            "Home" => false,
                            "End" => true,
                            _ => return,
                        };
                        event.prevent_default();
                        select_tab(next);
                    }>
                    <button id="settings-tab" type="button" role="tab" node_ref=settings_tab
                        aria-controls="settings-panel"
                        aria-selected=move || (!about_open.get()).to_string()
                        tabindex=move || if about_open.get() { -1 } else { 0 }
                        on:click=move |_| select_tab(false)>"Settings"</button>
                    <button id="about-tab" type="button" role="tab" node_ref=about_tab
                        aria-controls="about-panel"
                        aria-selected=move || about_open.get().to_string()
                        tabindex=move || if about_open.get() { 0 } else { -1 }
                        on:click=move |_| select_tab(true)>"About"</button>
                </div>
                <button class="settings-close" type="button" aria-label="Close dialog"
                    on:click=move |_| close()>"×"</button>
            </div>
            <div class="settings-panels">
            <div id="settings-panel" class="settings-panel settings-body" role="tabpanel"
                aria-labelledby="settings-tab" hidden=move || about_open.get()>
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
                        prop:value=move || settings.get().mono_font
                        on:change=move |event| set_setting("monoFont", &event_target_value(&event))>
                        <For each=move || settings.get().fonts key=|font| font.clone() children=|font| view! {
                            <option value=font.clone()>{font.clone()}</option>
                        }/>
                    </select>
                </label>
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
            <div id="about-panel" class="settings-panel" role="tabpanel"
                aria-labelledby="about-tab" hidden=move || !about_open.get()>
                <AboutContent/>
            </div>
            </div>
            <div class="settings-footer">
                <Show when=move || !about_open.get() fallback=move || view! {
                    <a href="/debug" on:click=move |_| close()>"Debug"</a>
                }>
                <button class="text-button" type="button" on:click=move |_| reset_settings()>
                    "Reset to defaults"
                </button>
                </Show>
                <button class="button" type="button" on:click=move |_| close()>"Done"</button>
            </div>
        </dialog>
    }
}
