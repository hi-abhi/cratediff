use crate::{
    components::page_title::PageTitle,
    diff::{CacheSnapshot, cache_snapshot},
};
use leptos::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use wasm_bindgen::JsValue;
use web_sys::Storage;

#[derive(Serialize)]
struct LocalStorageDump {
    entry_count: usize,
    entries: BTreeMap<String, serde_json::Value>,
    error: Option<String>,
}

fn read_local_storage() -> LocalStorageDump {
    let mut entries = BTreeMap::new();
    let result = (|| -> Result<(), JsValue> {
        let storage: Storage = window()
            .local_storage()?
            .ok_or_else(|| JsValue::from_str("Local storage is unavailable."))?;
        for index in 0..storage.length()? {
            if let Some(key) = storage.key(index)?
                && let Some(value) = storage.get_item(&key)?
            {
                let value =
                    serde_json::from_str(&value).unwrap_or(serde_json::Value::String(value));
                entries.insert(key, value);
            }
        }
        Ok(())
    })();
    LocalStorageDump {
        entry_count: entries.len(),
        entries,
        error: result
            .err()
            .map(|error| format!("Unable to read local storage: {error:?}")),
    }
}

struct DebugSnapshot {
    caches: CacheSnapshot,
    local_storage: LocalStorageDump,
}

impl DebugSnapshot {
    fn capture() -> Self {
        Self {
            caches: cache_snapshot(),
            local_storage: read_local_storage(),
        }
    }
}

#[component]
pub fn DebugPage() -> impl IntoView {
    let snapshot = DebugSnapshot::capture();
    let cache_dump =
        serde_json::to_string_pretty(&snapshot.caches).expect("serializable cache snapshot");
    let storage_dump = serde_json::to_string_pretty(&snapshot.local_storage)
        .expect("serializable storage snapshot");
    view! {
        <article class="debug-page">
            <PageTitle text=Signal::derive(|| "Debug - Crate Diff".to_owned())/>
            <h1>"Debug"</h1>
            <h2>"Local storage"</h2>
            <p>"All localStorage keys for this site, including saved settings. Stored JSON is expanded for readability."</p>
            <pre aria-label="Local storage dump">{storage_dump}</pre>
            <h2>"Crate caches"</h2>
            <p>"Caches belong to this tab's running app. A full page reload clears them. All sizes are in bytes. Metadata sizes measure serialized cached JSON; source sizes measure uncompressed file contents. Totals exclude allocator and container overhead."</p>
            <pre aria-label="Cache dump">{cache_dump}</pre>
        </article>
    }
}
