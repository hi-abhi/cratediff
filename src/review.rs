//! Shareable review scopes; directory boundaries must not match sibling names.
use crate::diff::{FileChange, FileStatus, comparison_url};
use leptos::prelude::*;
use leptos_router::hooks::use_query_map;

/// None selects a single file; Some("") selects all changes in the crate.
pub fn use_review_scope() -> Memo<Option<String>> {
    let query = use_query_map();
    Memo::new(move |_| {
        query.with(|query| {
            (query.get("view").as_deref() == Some("changes"))
                .then(|| normalize_scope(&query.get("scope").unwrap_or_default()))
        })
    })
}

pub fn normalize_scope(directory: &str) -> String {
    let directory = directory.trim_matches('/');
    if directory.is_empty() {
        String::new()
    } else {
        format!("{directory}/")
    }
}

pub fn view_url(name: &str, old: &str, new: &str, file: &str, scope: Option<&str>) -> String {
    let base = comparison_url(name, old, new, file);
    let Some(directory) = scope else { return base };
    let directory = normalize_scope(directory);
    if directory.is_empty() {
        format!("{base}?view=changes")
    } else {
        format!(
            "{base}?view=changes&scope={}",
            urlencoding::encode(&directory)
        )
    }
}

pub fn scoped_changes(files: &[FileChange], directory: &str) -> Vec<FileChange> {
    let directory = normalize_scope(directory);
    files
        .iter()
        .filter(|file| file.status != FileStatus::Unchanged && file.path.starts_with(&directory))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_review_includes_descendants_and_excludes_siblings_and_unchanged_files() {
        let files = [
            ("src/lib.rs", FileStatus::Modified),
            ("src/nested/value.rs", FileStatus::Added),
            ("src/old.rs", FileStatus::Removed),
            ("src/unchanged.rs", FileStatus::Unchanged),
            ("src-extra/lib.rs", FileStatus::Modified),
            ("tests/test.rs", FileStatus::Modified),
        ]
        .into_iter()
        .map(|(path, status)| FileChange {
            path: path.into(),
            status,
            added: 0,
            removed: 0,
        })
        .collect::<Vec<_>>();
        assert_eq!(
            scoped_changes(&files, "src")
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["src/lib.rs", "src/nested/value.rs", "src/old.rs"]
        );
        assert_eq!(scoped_changes(&files, "").len(), 5);
        assert!(scoped_changes(&files, "missing").is_empty());
    }

    #[test]
    fn review_links_encode_directory_and_file_names_without_reserving_file_paths() {
        assert_eq!(
            view_url("demo", "1.0.0", "2.0.0", "src/a b.rs", Some("src/a & b")),
            "/crate/demo/1.0.0/2.0.0/src/a%20b.rs?view=changes&scope=src%2Fa%20%26%20b%2F"
        );
        assert_eq!(
            view_url("demo", "1.0.0", "2.0.0", "", Some("")),
            "/crate/demo/1.0.0/2.0.0?view=changes"
        );
        assert_eq!(
            view_url("demo", "1.0.0", "2.0.0", "src/a b.rs", None),
            "/crate/demo/1.0.0/2.0.0/src/a%20b.rs"
        );
    }
}
