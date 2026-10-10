use flate2::read::GzDecoder;
use gloo_net::http::Request;
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use similar::{ChangeTag, TextDiff};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, HashMap},
    io::Read,
    sync::Arc,
};

use crate::data::Crate;

pub type Files = BTreeMap<String, Vec<u8>>;

#[derive(Clone, Debug, PartialEq)]
pub enum LoadError {
    NotFound(String),
    Message(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(message) | Self::Message(message) => f.write_str(message),
        }
    }
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
pub struct CrateResponse {
    #[serde(rename = "crate")]
    pub krate: Crate,
    #[serde(deserialize_with = "deserialize_versions")]
    pub versions: Vec<VersionInfo>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, PartialEq)]
pub struct VersionInfo {
    pub num: String,
    pub checksum: String,
    pub yanked: bool,
}

// The registry's response order is not version precedence. Normalize once so
// both selectors and the latest/previous aliases use the same descending order.
fn deserialize_versions<'de, D>(deserializer: D) -> Result<Vec<VersionInfo>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let versions = Vec::<VersionInfo>::deserialize(deserializer)?;
    let mut versions = versions
        .into_iter()
        .map(|version| (Version::parse(&version.num).ok(), version))
        .collect::<Vec<_>>();
    versions.sort_by(|(left, _), (right, _)| match (left, right) {
        (Some(left), Some(right)) => right.cmp_precedence(left),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    Ok(versions.into_iter().map(|(_, version)| version).collect())
}

impl CrateResponse {
    pub fn resolve(&self, requested: &str) -> Result<VersionInfo, LoadError> {
        let version = match requested {
            "latest" => self.versions.first(),
            "previous" => self.versions.get(1).or(self.versions.first()),
            _ => self
                .versions
                .iter()
                .find(|version| version.num == requested),
        };
        version.cloned().ok_or_else(|| {
            LoadError::NotFound(format!(
                "Version {requested} of {} was not found.",
                self.krate.id
            ))
        })
    }
}

const METADATA_CACHE_LIMIT: usize = 16;
const SOURCE_CACHE_LIMIT: usize = 10;

thread_local! {
    static METADATA_CACHE: RefCell<HashMap<String, CrateResponse>> = RefCell::new(HashMap::new());
    // Bound the source cache so browsing many versions does not retain every archive.
    static SOURCE_CACHE: RefCell<HashMap<(String, String), Arc<Files>>> = RefCell::new(HashMap::new());
}

#[derive(serde::Serialize)]
pub struct CacheSnapshot {
    metadata: CacheDetails<MetadataCacheEntry>,
    sources: CacheDetails<SourceCacheEntry>,
    total_bytes: usize,
}

#[derive(serde::Serialize)]
struct CacheDetails<Entry> {
    entry_count: usize,
    entry_limit: usize,
    total_bytes: usize,
    entries: Vec<Entry>,
}

#[derive(serde::Serialize)]
struct MetadataCacheEntry {
    crate_name: String,
    versions: Vec<String>,
    bytes: usize,
}

#[derive(serde::Serialize)]
struct SourceCacheEntry {
    crate_name: String,
    version: String,
    file_count: usize,
    bytes: usize,
}

/// Read cached payload sizes without cloning source contents or changing caches.
/// Metadata uses serialized JSON bytes; sources use uncompressed file bytes.
pub fn cache_snapshot() -> CacheSnapshot {
    let mut metadata_entries = METADATA_CACHE.with(|cache| {
        cache
            .borrow()
            .iter()
            .map(|(name, metadata)| MetadataCacheEntry {
                crate_name: name.clone(),
                versions: metadata
                    .versions
                    .iter()
                    .map(|version| version.num.clone())
                    .collect(),
                bytes: serde_json::to_vec(metadata)
                    .expect("serializable crate metadata")
                    .len(),
            })
            .collect::<Vec<_>>()
    });
    metadata_entries.sort_by(|left, right| left.crate_name.cmp(&right.crate_name));
    let mut source_entries = SOURCE_CACHE.with(|cache| {
        cache
            .borrow()
            .iter()
            .map(|((name, version), files)| SourceCacheEntry {
                crate_name: name.clone(),
                version: version.clone(),
                file_count: files.len(),
                bytes: files.values().map(Vec::len).sum(),
            })
            .collect::<Vec<_>>()
    });
    source_entries.sort_by(|left, right| {
        left.crate_name.cmp(&right.crate_name).then_with(|| {
            match (
                Version::parse(&left.version),
                Version::parse(&right.version),
            ) {
                (Ok(left), Ok(right)) => right.cmp_precedence(&left),
                _ => left.version.cmp(&right.version),
            }
        })
    });
    let metadata_bytes = metadata_entries
        .iter()
        .map(|entry| entry.bytes)
        .sum::<usize>();
    let source_bytes = source_entries
        .iter()
        .map(|entry| entry.bytes)
        .sum::<usize>();
    CacheSnapshot {
        metadata: CacheDetails {
            entry_count: metadata_entries.len(),
            entry_limit: METADATA_CACHE_LIMIT,
            total_bytes: metadata_bytes,
            entries: metadata_entries,
        },
        sources: CacheDetails {
            entry_count: source_entries.len(),
            entry_limit: SOURCE_CACHE_LIMIT,
            total_bytes: source_bytes,
            entries: source_entries,
        },
        total_bytes: metadata_bytes + source_bytes,
    }
}

pub async fn fetch_crate(name: &str) -> Result<CrateResponse, LoadError> {
    if let Some(cached) = METADATA_CACHE.with(|cache| cache.borrow().get(name).cloned()) {
        return Ok(cached);
    }
    let response = Request::get(&format!(
        "https://crates.io/api/v1/crates/{}",
        urlencoding::encode(name)
    ))
    .send()
    .await
    .map_err(|_| {
        LoadError::Message("Could not reach crates.io. Check your connection and try again.".into())
    })?;
    if response.status() == 404 {
        return Err(LoadError::NotFound(format!(
            "The crate “{name}” was not found on crates.io."
        )));
    }
    if !response.ok() {
        return Err(LoadError::Message(format!(
            "crates.io returned HTTP {}. Please try again.",
            response.status()
        )));
    }
    let metadata: CrateResponse = response
        .json()
        .await
        .map_err(|_| LoadError::Message("Could not read the crate metadata.".into()))?;
    METADATA_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.len() >= METADATA_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(name.to_owned(), metadata.clone());
    });
    Ok(metadata)
}

pub async fn fetch_source(name: &str, version: &VersionInfo) -> Result<Arc<Files>, LoadError> {
    let cache_key = (name.to_owned(), version.num.clone());
    let key = format!("{name}-{}", version.num);
    if let Some(cached) = SOURCE_CACHE.with(|cache| cache.borrow().get(&cache_key).cloned()) {
        return Ok(cached);
    }
    let url = format!("https://static.crates.io/crates/{name}/{key}.crate");
    let response = Request::get(&url).send().await.map_err(|_| {
        LoadError::Message(format!(
            "Could not download {key}. Check your connection and try again."
        ))
    })?;
    if !response.ok() {
        return Err(LoadError::Message(format!(
            "Downloading {key} returned HTTP {}.",
            response.status()
        )));
    }
    let bytes = response
        .binary()
        .await
        .map_err(|_| LoadError::Message(format!("Could not read {key}.")))?;
    let files =
        Arc::new(unpack_source(&key, &version.checksum, &bytes).map_err(LoadError::Message)?);
    SOURCE_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.len() >= SOURCE_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(cache_key, files.clone());
    });
    Ok(files)
}

fn sha256_checksum(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn unpack_source(prefix: &str, checksum: &str, bytes: &[u8]) -> Result<Files, String> {
    let actual = sha256_checksum(bytes);
    if !actual.eq_ignore_ascii_case(checksum) {
        return Err(format!(
            "Checksum mismatch for {prefix}. The archive was not opened."
        ));
    }
    let mut archive = tar::Archive::new(GzDecoder::new(bytes));
    let mut files = Files::new();
    let mut total_size = 0_u64;
    let prefix = format!("{prefix}/");
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let raw = entry.path_bytes();
        let full_path =
            std::str::from_utf8(&raw).map_err(|_| "An archive path is not valid UTF-8.")?;
        let path = full_path
            .strip_prefix(&prefix)
            .ok_or("An archive file has an unexpected prefix.")?
            .to_owned();
        if path.is_empty()
            || path
                .split('/')
                .any(|part| part == ".." || part == "." || part.is_empty())
        {
            return Err("An archive file has an invalid path.".into());
        }
        total_size = total_size
            .checked_add(entry.size())
            .ok_or("Archive size overflow.")?;
        if total_size > 128 * 1024 * 1024 {
            return Err("This crate is too large to open in the browser (128 MiB limit).".into());
        }
        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .map_err(|error| error.to_string())?;
        if files.insert(path, contents).is_some() {
            return Err("The archive contains duplicate file paths.".into());
        }
    }
    Ok(files)
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    #[serde(rename = "deleted")]
    Removed,
    Modified,
    Unchanged,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileStatus,
    pub added: usize,
    pub removed: usize,
}

pub fn text(bytes: &[u8]) -> Option<&str> {
    if bytes.contains(&0) {
        None
    } else {
        std::str::from_utf8(bytes).ok()
    }
}

pub fn file_changes(old: &Files, new: &Files) -> Vec<FileChange> {
    let paths: BTreeSet<_> = old.keys().chain(new.keys()).cloned().collect();
    paths
        .into_iter()
        .map(|path| {
            let before = old.get(&path);
            let after = new.get(&path);
            let status = match (before, after) {
                (None, Some(_)) => FileStatus::Added,
                (Some(_), None) => FileStatus::Removed,
                (Some(left), Some(right)) if left == right => FileStatus::Unchanged,
                _ => FileStatus::Modified,
            };
            let (mut added, mut removed) = (0, 0);
            if status != FileStatus::Unchanged
                && let (Some(left), Some(right)) = (
                    text(before.map(Vec::as_slice).unwrap_or_default()),
                    text(after.map(Vec::as_slice).unwrap_or_default()),
                )
            {
                for line in TextDiff::from_lines(left, right).iter_all_changes() {
                    match line.tag() {
                        ChangeTag::Insert => added += 1,
                        ChangeTag::Delete => removed += 1,
                        _ => {}
                    }
                }
            }
            FileChange {
                path,
                status,
                added,
                removed,
            }
        })
        .collect()
}

pub fn crate_url(name: &str) -> String {
    format!("/crate/{}", urlencoding::encode(name))
}

pub fn comparison_url(name: &str, old: &str, new: &str, file: &str) -> String {
    let base = format!(
        "{}/{}/{}",
        crate_url(name),
        urlencoding::encode(old),
        urlencoding::encode(new)
    );
    if file.is_empty() {
        base
    } else {
        format!(
            "{base}/{}",
            file.split('/')
                .map(|part| urlencoding::encode(part).into_owned())
                .collect::<Vec<_>>()
                .join("/")
        )
    }
}

#[derive(Clone)]
pub struct Comparison {
    pub old: VersionInfo,
    pub new: VersionInfo,
    pub old_files: Arc<Files>,
    pub new_files: Arc<Files>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
        for (path, bytes) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, *bytes).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn archives_are_verified_and_paths_are_relative() {
        let bytes = archive(&[("demo-1.0.0/src/lib.rs", b"pub fn demo() {}\n")]);
        let checksum = sha256_checksum(&bytes);
        let files = unpack_source("demo-1.0.0", &checksum, &bytes).unwrap();
        assert_eq!(files["src/lib.rs"], b"pub fn demo() {}\n");
        assert!(
            unpack_source("demo-1.0.0", "wrong-checksum", &bytes)
                .unwrap_err()
                .contains("Checksum mismatch")
        );
        assert!(
            unpack_source("other-1.0.0", &checksum, &bytes)
                .unwrap_err()
                .contains("unexpected prefix")
        );
    }

    #[test]
    fn duplicate_paths_are_rejected() {
        let bytes = archive(&[("demo-1.0.0/lib.rs", b"one"), ("demo-1.0.0/lib.rs", b"two")]);
        let checksum = sha256_checksum(&bytes);
        assert!(
            unpack_source("demo-1.0.0", &checksum, &bytes)
                .unwrap_err()
                .contains("duplicate")
        );
    }

    #[test]
    fn file_union_covers_added_removed_modified_and_binary_files() {
        let old = Files::from([
            ("modified.rs".into(), b"a\nb\n".to_vec()),
            ("removed.rs".into(), b"gone\n".to_vec()),
            ("same.rs".into(), b"same\n".to_vec()),
            ("binary.dat".into(), vec![0, 1]),
        ]);
        let new = Files::from([
            ("modified.rs".into(), b"a\nc\nd\n".to_vec()),
            ("added.rs".into(), b"new\n".to_vec()),
            ("same.rs".into(), b"same\n".to_vec()),
            ("binary.dat".into(), vec![0, 2]),
        ]);
        let files = file_changes(&old, &new)
            .into_iter()
            .map(|file| (file.path.clone(), file))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(files.len(), 5);
        assert_eq!(files["modified.rs"].status, FileStatus::Modified);
        assert_eq!(
            (files["modified.rs"].added, files["modified.rs"].removed),
            (2, 1)
        );
        assert_eq!(files["added.rs"].status, FileStatus::Added);
        assert_eq!(files["removed.rs"].status, FileStatus::Removed);
        assert_eq!(files["same.rs"].status, FileStatus::Unchanged);
        assert_eq!(files["binary.dat"].status, FileStatus::Modified);
        assert!(text(&[0, 1]).is_none());
        assert!(text(&[0xff]).is_none());
    }

    fn metadata() -> CrateResponse {
        serde_json::from_value(serde_json::json!({
            "crate": {
                "id": "demo", "max_version": "2.0.0", "description": null,
                "downloads": 0, "repository": null, "documentation": null
            },
            "versions": [
                { "num": "2.0.0", "checksum": "a", "yanked": false },
                { "num": "1.2.0", "checksum": "b", "yanked": true },
                { "num": "1.0.0", "checksum": "c", "yanked": false }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn cache_snapshot_reports_each_version_and_payload_totals_without_eviction() {
        let metadata = metadata();
        let metadata_bytes = serde_json::to_vec(&metadata).unwrap().len();
        METADATA_CACHE.with(|cache| {
            let mut cache = cache.borrow_mut();
            cache.clear();
            cache.insert("demo".into(), metadata);
        });
        let prerelease_files = Arc::new(Files::from([
            ("one.rs".into(), vec![1, 2, 3]),
            ("two.rs".into(), vec![4, 5, 6, 7, 8]),
        ]));
        SOURCE_CACHE.with(|cache| {
            let mut cache = cache.borrow_mut();
            cache.clear();
            cache.insert(
                ("hyphenated-crate".into(), "1.0.0-rc.1".into()),
                prerelease_files.clone(),
            );
            cache.insert(
                ("hyphenated-crate".into(), "1.0.0".into()),
                Arc::new(Files::from([("lib.rs".into(), vec![9])])),
            );
        });
        let snapshot = cache_snapshot();
        assert_eq!(snapshot.metadata.entry_count, 1);
        assert_eq!(snapshot.metadata.entries[0].crate_name, "demo");
        assert_eq!(
            snapshot.metadata.entries[0].versions,
            ["2.0.0", "1.2.0", "1.0.0"]
        );
        assert_eq!(snapshot.metadata.total_bytes, metadata_bytes);
        assert_eq!(snapshot.sources.entry_count, 2);
        assert_eq!(snapshot.sources.entries[0].version, "1.0.0");
        assert_eq!(snapshot.sources.entries[1].version, "1.0.0-rc.1");
        assert_eq!(snapshot.sources.entries[1].crate_name, "hyphenated-crate");
        assert_eq!(snapshot.sources.entries[1].file_count, 2);
        assert_eq!(snapshot.sources.entries[1].bytes, 8);
        assert_eq!(snapshot.sources.total_bytes, 9);
        assert_eq!(snapshot.total_bytes, metadata_bytes + 9);
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            serde_json::to_value(cache_snapshot()).unwrap()
        );
        SOURCE_CACHE.with(|cache| {
            assert!(Arc::ptr_eq(
                cache
                    .borrow()
                    .get(&("hyphenated-crate".into(), "1.0.0-rc.1".into()))
                    .unwrap(),
                &prerelease_files,
            ));
            cache.borrow_mut().clear();
        });
        METADATA_CACHE.with(|cache| cache.borrow_mut().clear());
    }

    #[test]
    fn resolve_named_and_exact_versions() {
        let mut metadata = metadata();
        assert_eq!(metadata.resolve("latest").unwrap().num, "2.0.0");
        assert_eq!(metadata.resolve("previous").unwrap().num, "1.2.0");
        assert!(metadata.resolve("1.2.0").unwrap().yanked);
        for range in ["^1", "~1.2", "1.*", ">=1.0.0", "1", "=1.2.0"] {
            assert!(matches!(
                metadata.resolve(range),
                Err(LoadError::NotFound(_))
            ));
        }
        assert!(matches!(
            metadata.resolve("1.1.0"),
            Err(LoadError::NotFound(_))
        ));
        assert!(matches!(
            metadata.resolve("5.0.0"),
            Err(LoadError::NotFound(_))
        ));
        metadata.versions.truncate(1);
        assert_eq!(metadata.resolve("previous").unwrap().num, "2.0.0");
    }

    #[test]
    fn versions_use_descending_semantic_precedence() {
        let mut response = serde_json::json!({
            "crate": {
                "id": "demo", "max_version": "10.0.0", "description": null,
                "downloads": 0, "repository": null, "documentation": null
            },
            "versions": []
        });
        let versions = [
            "1.9.0",
            "2.0.0-rc.2",
            "1.10.0",
            "10.0.0",
            "2.0.0-rc.10",
            "2.0.0",
            "2.0.0-beta",
            "1.10.1",
            "2.0.0-alpha",
            "legacy",
            "2.0.0+z",
            "2.0.0+a",
        ];
        response["versions"] = serde_json::Value::Array(versions.into_iter().map(|num| {
            serde_json::json!({ "num": num, "checksum": num, "yanked": num == "1.10.0" })
        }).collect());
        let metadata: CrateResponse = serde_json::from_value(response).unwrap();
        assert_eq!(
            metadata
                .versions
                .iter()
                .map(|version| version.num.as_str())
                .collect::<Vec<_>>(),
            [
                "10.0.0",
                "2.0.0",
                "2.0.0+z",
                "2.0.0+a",
                "2.0.0-rc.10",
                "2.0.0-rc.2",
                "2.0.0-beta",
                "2.0.0-alpha",
                "1.10.1",
                "1.10.0",
                "1.9.0",
                "legacy",
            ]
        );
        assert_eq!(metadata.resolve("latest").unwrap().num, "10.0.0");
        assert_eq!(metadata.resolve("previous").unwrap().num, "2.0.0");
        assert_eq!(metadata.resolve("2.0.0+z").unwrap().num, "2.0.0+z");
        assert!(metadata.resolve("1.10.0").unwrap().yanked);
    }

    #[test]
    fn shareable_urls_encode_versions_and_file_segments() {
        assert_eq!(crate_url("demo"), "/crate/demo");
        assert_eq!(crate_url("a crate"), "/crate/a%20crate");
        assert_eq!(
            comparison_url("demo", "1.0.0+build.1", "latest", "src/a b.rs"),
            "/crate/demo/1.0.0%2Bbuild.1/latest/src/a%20b.rs"
        );
        assert_eq!(
            comparison_url("demo", "1.0.0", "2.0.0", ""),
            "/crate/demo/1.0.0/2.0.0"
        );
    }
}
