//! CDN source manifests and independently verified ZIP entries.
use crate::diff::{Files, LoadError, VersionInfo, unpack_source};
use flate2::read::DeflateDecoder;
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    io::Read,
    sync::Arc,
};

const CACHE_LIMIT: usize = 10;
const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
type Contents = BTreeMap<String, Arc<Vec<u8>>>;
pub type FilePair = (Option<Arc<Vec<u8>>>, Option<Arc<Vec<u8>>>);

#[derive(Clone, Debug, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub data_offset: u64,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub compression: String,
    pub sha256: String,
}

#[derive(Deserialize)]
struct Manifest {
    files: Vec<ManifestFile>,
}

#[derive(Clone)]
pub struct SourceRelease {
    pub name: String,
    pub version: String,
    pub files: Arc<BTreeMap<String, ManifestFile>>,
    manifest_bytes: usize,
    // Retain legacy contents while an active comparison outlives its cache entry.
    legacy: Option<Arc<Contents>>,
}

struct CachedSource {
    source: SourceRelease,
    contents: Contents,
}

thread_local! {
    static SOURCE_CACHE: RefCell<HashMap<(String, String), CachedSource>> = RefCell::new(HashMap::new());
}

fn archive_url(name: &str, version: &str, extension: &str) -> String {
    format!(
        "https://static.crates.io/crates/{}/{name}-{}.{extension}",
        urlencoding::encode(name),
        urlencoding::encode(version),
        name = urlencoding::encode(name),
    )
}

fn cache_source(source: &SourceRelease) {
    SOURCE_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let key = (source.name.clone(), source.version.clone());
        if cache.contains_key(&key) {
            return;
        }
        if cache.len() >= CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(
            key,
            CachedSource {
                source: source.clone(),
                contents: source.legacy.as_deref().cloned().unwrap_or_default(),
            },
        );
    });
}

fn cache_file(source: &SourceRelease, path: &str, bytes: Arc<Vec<u8>>) {
    cache_source(source);
    SOURCE_CACHE.with(|cache| {
        cache
            .borrow_mut()
            .get_mut(&(source.name.clone(), source.version.clone()))
            .unwrap()
            .contents
            .insert(path.to_owned(), bytes);
    });
}

fn validate_manifest(files: Vec<ManifestFile>) -> Result<BTreeMap<String, ManifestFile>, String> {
    let mut result = BTreeMap::new();
    let mut total = 0_u64;
    for file in files {
        if file.path.starts_with('/')
            || file.path.contains('\\')
            || file
                .path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err("The source manifest contains an invalid file path.".into());
        }
        if !matches!(file.compression.as_str(), "store" | "deflate") {
            return Err(format!("Unsupported compression for {}.", file.path));
        }
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("Invalid SHA-256 for {}.", file.path));
        }
        file.data_offset
            .checked_add(file.compressed_size)
            .ok_or("File range overflow.")?;
        if file.compressed_size > MAX_SOURCE_BYTES {
            return Err("A compressed source file exceeds the 128 MiB limit.".into());
        }
        total = total
            .checked_add(file.uncompressed_size)
            .ok_or("Source size overflow.")?;
        if total > MAX_SOURCE_BYTES {
            return Err("This crate is too large to open in the browser (128 MiB limit).".into());
        }
        if result.insert(file.path.clone(), file).is_some() {
            return Err("The source manifest contains duplicate file paths.".into());
        }
    }
    Ok(result)
}

pub async fn fetch_source(name: &str, version: &VersionInfo) -> Result<SourceRelease, LoadError> {
    if let Some(source) = SOURCE_CACHE.with(|cache| {
        cache
            .borrow()
            .get(&(name.to_owned(), version.num.clone()))
            .map(|entry| entry.source.clone())
    }) {
        return Ok(source);
    }
    let url = archive_url(name, &version.num, "zip.json");
    let response = Request::get(&url).send().await.map_err(|_| {
        LoadError::Message(format!(
            "Could not load the source manifest for {name}-{}.",
            version.num
        ))
    })?;
    let source = if matches!(response.status(), 403 | 404) {
        // New publications can precede the ZIP background job. Only a missing
        // manifest permits the older, checksum-verified Cargo archive fallback.
        fetch_legacy(name, version).await?
    } else {
        if !response.ok() {
            return Err(LoadError::Message(format!(
                "Loading the source manifest returned HTTP {}.",
                response.status()
            )));
        }
        let bytes = response
            .binary()
            .await
            .map_err(|_| LoadError::Message("Could not read the source manifest.".into()))?;
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(LoadError::Message(
                "The source manifest exceeds the 8 MiB limit.".into(),
            ));
        }
        let manifest: Manifest = serde_json::from_slice(&bytes)
            .map_err(|_| LoadError::Message("Could not parse the source manifest.".into()))?;
        SourceRelease {
            name: name.to_owned(),
            version: version.num.clone(),
            files: Arc::new(validate_manifest(manifest.files).map_err(LoadError::Message)?),
            manifest_bytes: bytes.len(),
            legacy: None,
        }
    };
    cache_source(&source);
    Ok(source)
}

async fn fetch_legacy(name: &str, version: &VersionInfo) -> Result<SourceRelease, LoadError> {
    let response = Request::get(&archive_url(name, &version.num, "crate"))
        .send()
        .await
        .map_err(|_| LoadError::Message("Could not download the legacy crate archive.".into()))?;
    if !response.ok() {
        return Err(LoadError::Message(format!(
            "Downloading the legacy archive returned HTTP {}.",
            response.status()
        )));
    }
    let bytes = response
        .binary()
        .await
        .map_err(|_| LoadError::Message("Could not read the legacy archive.".into()))?;
    let files = unpack_source(
        &format!("{name}-{}", version.num),
        &version.checksum,
        &bytes,
    )
    .map_err(LoadError::Message)?;
    Ok(legacy_source(name, &version.num, files))
}

fn legacy_source(name: &str, version: &str, files: Files) -> SourceRelease {
    let mut manifest = BTreeMap::new();
    let mut contents = Contents::new();
    for (path, bytes) in files {
        manifest.insert(
            path.clone(),
            ManifestFile {
                path: path.clone(),
                data_offset: 0,
                compressed_size: bytes.len() as u64,
                uncompressed_size: bytes.len() as u64,
                compression: "store".into(),
                sha256: checksum(&bytes),
            },
        );
        contents.insert(path, Arc::new(bytes));
    }
    SourceRelease {
        name: name.into(),
        version: version.into(),
        files: Arc::new(manifest),
        manifest_bytes: 0,
        legacy: Some(Arc::new(contents)),
    }
}

fn checksum(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_file(file: &ManifestFile, compressed: &[u8]) -> Result<Vec<u8>, String> {
    if compressed.len() as u64 != file.compressed_size {
        return Err(format!("Incorrect compressed size for {}.", file.path));
    }
    let reader: Box<dyn Read> = match file.compression.as_str() {
        "store" => Box::new(compressed),
        "deflate" => Box::new(DeflateDecoder::new(compressed)),
        _ => return Err(format!("Unsupported compression for {}.", file.path)),
    };
    let mut bytes = Vec::new();
    reader
        .take(file.uncompressed_size + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("Could not decompress {}.", file.path))?;
    if bytes.len() as u64 != file.uncompressed_size
        || !checksum(&bytes).eq_ignore_ascii_case(&file.sha256)
    {
        return Err(format!(
            "Integrity check failed for {}: size or SHA-256 mismatch.",
            file.path
        ));
    }
    Ok(bytes)
}

pub async fn fetch_file(
    source: &SourceRelease,
    path: &str,
) -> Result<Option<Arc<Vec<u8>>>, LoadError> {
    let Some(file) = source.files.get(path) else {
        return Ok(None);
    };
    if let Some(bytes) = SOURCE_CACHE
        .with(|cache| {
            cache
                .borrow()
                .get(&(source.name.clone(), source.version.clone()))
                .and_then(|entry| entry.contents.get(path).cloned())
        })
        .or_else(|| {
            source
                .legacy
                .as_ref()
                .and_then(|contents| contents.get(path).cloned())
        })
    {
        return Ok(Some(bytes));
    }
    let compressed = if file.compressed_size == 0 {
        Vec::new()
    } else {
        let end = file.data_offset + file.compressed_size - 1;
        let response = Request::get(&archive_url(&source.name, &source.version, "zip"))
            .header("Range", &format!("bytes={}-{end}", file.data_offset))
            // Browser HTTP caches can expand subsequent partial requests into
            // whole-ZIP responses. Our verified file cache handles revisits.
            .cache(web_sys::RequestCache::NoStore)
            .send()
            .await
            .map_err(|_| LoadError::Message(format!("Could not download {}.", file.path)))?;
        if !matches!(response.status(), 200 | 206) {
            return Err(LoadError::Message(format!(
                "Loading {} returned HTTP {}.",
                file.path,
                response.status()
            )));
        }
        let status = response.status();
        let bytes = response
            .binary()
            .await
            .map_err(|_| LoadError::Message(format!("Could not read {}.", file.path)))?;
        if status == 200 {
            // Some intermediaries ignore Range. Still verify the exact entry.
            let start = usize::try_from(file.data_offset).map_err(|_| {
                LoadError::Message(format!("File offset is too large for {}.", file.path))
            })?;
            let end = usize::try_from(end + 1).map_err(|_| {
                LoadError::Message(format!("File range is too large for {}.", file.path))
            })?;
            bytes
                .get(start..end)
                .ok_or_else(|| {
                    LoadError::Message(format!("Incomplete archive response for {}.", file.path))
                })?
                .to_vec()
        } else {
            bytes
        }
    };
    let bytes = Arc::new(decode_file(file, &compressed).map_err(LoadError::Message)?);
    cache_file(source, path, bytes.clone());
    Ok(Some(bytes))
}

pub async fn fetch_pair(
    old: &SourceRelease,
    new: &SourceRelease,
    path: &str,
) -> Result<FilePair, LoadError> {
    if let (Some(left), Some(right)) = (old.files.get(path), new.files.get(path))
        && left.sha256.eq_ignore_ascii_case(&right.sha256)
        && left.uncompressed_size == right.uncompressed_size
    {
        let bytes = fetch_file(new, path).await?;
        if let Some(bytes) = &bytes {
            cache_file(old, path, bytes.clone());
        }
        return Ok((bytes.clone(), bytes));
    }
    let (left, right) = futures::join!(fetch_file(old, path), fetch_file(new, path));
    Ok((left?, right?))
}

#[derive(Serialize)]
pub struct SourceCacheSnapshot {
    pub entry_count: usize,
    pub entry_limit: usize,
    pub total_bytes: usize,
    pub entries: Vec<SourceCacheEntry>,
}

#[derive(Serialize)]
pub struct SourceCacheEntry {
    pub crate_name: String,
    pub version: String,
    pub file_count: usize,
    pub cached_file_count: usize,
    pub manifest_bytes: usize,
    pub content_bytes: usize,
    pub bytes: usize,
    pub format: &'static str,
    pub files: Vec<CachedFileEntry>,
}

#[derive(Serialize)]
pub struct CachedFileEntry {
    path: String,
    bytes: usize,
}

pub fn cache_snapshot() -> SourceCacheSnapshot {
    let mut entries = SOURCE_CACHE.with(|cache| {
        cache
            .borrow()
            .values()
            .map(|entry| {
                let files = entry
                    .contents
                    .iter()
                    .map(|(path, bytes)| CachedFileEntry {
                        path: path.clone(),
                        bytes: bytes.len(),
                    })
                    .collect::<Vec<_>>();
                let content_bytes = files.iter().map(|file| file.bytes).sum::<usize>();
                SourceCacheEntry {
                    crate_name: entry.source.name.clone(),
                    version: entry.source.version.clone(),
                    file_count: entry.source.files.len(),
                    cached_file_count: files.len(),
                    manifest_bytes: entry.source.manifest_bytes,
                    content_bytes,
                    bytes: entry.source.manifest_bytes + content_bytes,
                    format: if entry.source.legacy.is_some() {
                        "crate"
                    } else {
                        "zip"
                    },
                    files,
                }
            })
            .collect::<Vec<_>>()
    });
    entries.sort_by(|left, right| {
        left.crate_name.cmp(&right.crate_name).then_with(|| {
            match (
                semver::Version::parse(&left.version),
                semver::Version::parse(&right.version),
            ) {
                (Ok(left), Ok(right)) => right.cmp_precedence(&left),
                _ => left.version.cmp(&right.version),
            }
        })
    });
    SourceCacheSnapshot {
        entry_count: entries.len(),
        entry_limit: CACHE_LIMIT,
        total_bytes: entries.iter().map(|entry| entry.bytes).sum(),
        entries,
    }
}

#[cfg(test)]
pub fn test_source(files: Files) -> SourceRelease {
    legacy_source("demo", "1.0.0", files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::DeflateEncoder};
    use std::io::Write;

    fn file(bytes: &[u8]) -> ManifestFile {
        ManifestFile {
            path: "src/lib.rs".into(),
            data_offset: 40,
            compressed_size: bytes.len() as u64,
            uncompressed_size: bytes.len() as u64,
            compression: "store".into(),
            sha256: checksum(bytes),
        }
    }

    #[test]
    fn manifest_rejects_invalid_paths_duplicates_ranges_methods_and_sizes() {
        let entry = file(b"hello");
        assert!(validate_manifest(vec![entry.clone()]).is_ok());
        assert!(validate_manifest(vec![entry.clone(), entry.clone()]).is_err());
        for path in [
            "",
            "/lib.rs",
            "../lib.rs",
            "src/../lib.rs",
            "src//lib.rs",
            "src\\lib.rs",
        ] {
            assert!(
                validate_manifest(vec![ManifestFile {
                    path: path.into(),
                    ..entry.clone()
                }])
                .is_err()
            );
        }
        assert!(
            validate_manifest(vec![ManifestFile {
                data_offset: u64::MAX,
                ..entry.clone()
            }])
            .is_err()
        );
        assert!(
            validate_manifest(vec![ManifestFile {
                uncompressed_size: MAX_SOURCE_BYTES + 1,
                ..entry.clone()
            }])
            .is_err()
        );
        assert!(
            validate_manifest(vec![ManifestFile {
                compression: "unknown".into(),
                ..entry.clone()
            }])
            .is_err()
        );
        assert!(
            validate_manifest(vec![ManifestFile {
                sha256: "wrong".into(),
                ..entry
            }])
            .is_err()
        );
    }

    #[test]
    fn files_verify_store_deflate_empty_and_corrupt_contents() {
        let bytes = b"pub fn example() {}\n";
        let mut entry = file(bytes);
        assert_eq!(decode_file(&entry, bytes).unwrap(), bytes);
        assert!(decode_file(&entry, b"corrupt").is_err());
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).unwrap();
        let compressed = encoder.finish().unwrap();
        entry.compression = "deflate".into();
        entry.compressed_size = compressed.len() as u64;
        assert_eq!(decode_file(&entry, &compressed).unwrap(), bytes);
        entry.uncompressed_size -= 1;
        assert!(decode_file(&entry, &compressed).is_err());
        assert!(decode_file(&file(b"hello"), b"world").is_err());
        assert_eq!(decode_file(&file(b""), b"").unwrap(), b"");
    }

    #[test]
    fn cache_reports_inventory_contents_and_payload_sizes_without_eviction() {
        SOURCE_CACHE.with(|cache| cache.borrow_mut().clear());
        let release = legacy_source(
            "demo",
            "1.0.0",
            Files::from([("lib.rs".into(), vec![1, 2, 3])]),
        );
        cache_source(&release);
        let snapshot = cache_snapshot();
        assert_eq!(snapshot.entry_count, 1);
        assert_eq!(snapshot.entries[0].file_count, 1);
        assert_eq!(snapshot.entries[0].cached_file_count, 1);
        assert_eq!(snapshot.total_bytes, 3);
        assert_eq!(snapshot.entries[0].format, "crate");
        assert_eq!(snapshot.entries[0].files[0].path, "lib.rs");
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::to_value(cache_snapshot()).unwrap()
        );
        SOURCE_CACHE.with(|cache| cache.borrow_mut().clear());
    }
}
