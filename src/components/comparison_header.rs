use super::version_controls::VersionControls;
use crate::diff::{CrateResponse, LoadError, VersionInfo};
use leptos::{html, portal::Portal, prelude::*};

#[derive(Clone, Copy)]
pub struct ComparisonHeaderMount {
    pub identity: NodeRef<html::Div>,
    pub versions: NodeRef<html::Div>,
}

#[component]
pub fn ComparisonHeader(
    metadata: CrateResponse,
    versions: Memo<Result<(VersionInfo, VersionInfo), LoadError>>,
) -> impl IntoView {
    let mounts = expect_context::<ComparisonHeaderMount>();
    let metadata = StoredValue::new(metadata);
    view! {
        {move || mounts.identity.get().map(|mount| view! {
            <Portal mount=mount>
                <h1 class="header-crate">
                    <a href=metadata.with_value(|metadata| format!("https://crates.io/crates/{}", metadata.krate.id))
                        title=metadata.with_value(|metadata| metadata.krate.description.clone().unwrap_or_default())>
                        {metadata.with_value(|metadata| metadata.krate.id.clone())}
                    </a>
                </h1>
            </Portal>
        })}
        {move || mounts.versions.get().map(|mount| view! {
            <Portal mount=mount>
                {move || versions.get().ok().map(|(old, new)| view! {
                    <VersionControls
                        name=metadata.with_value(|metadata| metadata.krate.id.clone())
                        versions=metadata.with_value(|metadata| metadata.versions.clone())
                        old=old.num new=new.num
                    />
                })}
            </Portal>
        })}
    }
}
