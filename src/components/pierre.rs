//! Browser bindings. Leptos owns the hosts, callbacks, and renderer cleanup.
use js_sys::Function;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Pierre, js_name = mountTree, catch)]
    pub fn mount_tree(
        host: &JsValue,
        files: &str,
        selected: &str,
        on_select: &Function,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(js_namespace = Pierre, js_name = updateTree)]
    pub fn update_tree(instance: &JsValue, paths: &str, selected: &str);

    #[wasm_bindgen(js_namespace = Pierre, js_name = collapseTree)]
    pub fn collapse_tree(instance: &JsValue);

    #[wasm_bindgen(js_namespace = Pierre, js_name = mountDiff, catch)]
    pub fn mount_diff(
        host: &JsValue,
        path: &str,
        old: Option<String>,
        new: Option<String>,
        identical: bool,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(js_namespace = Pierre, js_name = updateDiff)]
    pub fn update_diff(instance: &JsValue, split: bool, all_lines: bool);

    #[wasm_bindgen(js_namespace = Pierre, js_name = cleanUp)]
    fn clean_up(instance: &JsValue);
}

pub struct Renderer(pub JsValue);

impl Drop for Renderer {
    fn drop(&mut self) {
        clean_up(&self.0);
    }
}
