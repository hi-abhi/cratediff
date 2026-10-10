use js_sys::Function;
use leptos::prelude::*;
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::{JsCast, closure::Closure};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub mode: String,
    pub resolved_mode: String,
    pub font_size: u32,
    pub code_width: String,
    pub mono_font: String,
    pub light_theme: String,
    pub dark_theme: String,
    pub fonts: Vec<String>,
    pub font_sizes: Vec<u32>,
    pub light_themes: Vec<ThemeOption>,
    pub dark_themes: Vec<ThemeOption>,
    pub detecting: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ThemeOption {
    pub id: String,
    pub label: String,
}

/// Observe the browser preferences for the lifetime of the current component.
pub fn use_settings() -> ReadSignal<SettingsSnapshot> {
    let initial = serde_json::from_str(&settings_snapshot()).expect("valid settings snapshot");
    let (settings, set_settings) = signal(initial);
    let callback = Closure::<dyn FnMut(String)>::new(move |json: String| {
        if let Ok(value) = serde_json::from_str(&json) {
            set_settings.set(value);
        }
    });
    let subscription = subscribe_settings(callback.as_ref().unchecked_ref());
    let resources = StoredValue::new_local(Some((subscription, callback)));
    on_cleanup(move || {
        resources.update_value(|resources| {
            if let Some((subscription, _callback)) = resources.take() {
                unsubscribe_settings(&subscription);
            }
        });
    });
    settings
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = getSnapshot)]
    pub fn settings_snapshot() -> String;
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = subscribeJson)]
    pub fn subscribe_settings(callback: &Function) -> JsValue;
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = unsubscribe)]
    pub fn unsubscribe_settings(subscription: &JsValue);
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = set)]
    pub fn set_setting(key: &str, value: &str);
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = open)]
    pub fn open_settings(dialog: &JsValue);
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = close)]
    pub fn close_settings(dialog: &JsValue);
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = detectFonts)]
    pub fn detect_fonts();
    #[wasm_bindgen(js_namespace = CrateSettings, js_name = reset)]
    pub fn reset_settings();
}
