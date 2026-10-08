use gloo_net::http::Request;
use serde::Deserialize;

const SUMMARY_URL: &str = "https://crates.io/api/v1/summary";

#[derive(Clone, Debug, Deserialize)]
pub struct Summary {
    pub most_downloaded: Vec<Crate>,
    pub just_updated: Vec<Crate>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, PartialEq)]
pub struct Crate {
    pub id: String,
    pub max_version: String,
    pub description: Option<String>,
    pub downloads: u64,
    pub repository: Option<String>,
    pub documentation: Option<String>,
}

impl Crate {
    pub fn documentation_url(&self) -> String {
        self.documentation
            .as_deref()
            .and_then(safe_web_url)
            .unwrap_or_else(|| format!("https://docs.rs/{}/{}", self.id, self.max_version))
    }
}

// Metadata links are supplied by crate authors. Only allow web URLs.
pub fn safe_web_url(url: &str) -> Option<String> {
    (url.starts_with("https://") || url.starts_with("http://")).then(|| url.to_owned())
}

pub fn format_downloads(downloads: u64) -> String {
    let digits = downloads.to_string();
    let mut result = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            result.push(',');
        }
        result.push(digit);
    }
    result
}

pub async fn fetch_summary() -> Result<Summary, String> {
    let response = Request::get(SUMMARY_URL).send().await.map_err(|_| {
        "Could not reach crates.io. Check your connection and try again.".to_owned()
    })?;

    if !response.ok() {
        return Err(format!(
            "crates.io returned HTTP {}. Please try again shortly.",
            response.status()
        ));
    }

    response
        .json()
        .await
        .map_err(|_| "Could not read the crates.io response. Please try again.".to_owned())
}
