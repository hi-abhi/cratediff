use leptos::prelude::*;

const DEFAULT_TITLE: &str = "Crate Diff - Compare diffs for Rust crate versions";

#[component]
pub fn PageTitle(#[prop(optional)] text: Option<Signal<String>>) -> impl IntoView {
    Effect::new(move |_| {
        let title = text
            .as_ref()
            .map(|text| text.get())
            .unwrap_or_else(|| DEFAULT_TITLE.to_owned());
        document().set_title(&title);
    });
}
