use crate::data::Crate;
use gloo_net::http::Request;
use serde::Deserialize;

pub const PAGE_SIZE: u64 = 20;

#[derive(Clone, Debug, Deserialize)]
pub struct SearchResponse {
    pub crates: Vec<Crate>,
    pub meta: SearchMeta,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SearchMeta {
    pub total: u64,
}

pub fn search_url(query: &str, page: u64) -> String {
    let query = query.trim();
    if query.is_empty() {
        return "/".to_owned();
    }
    let url = format!("/search/{}", urlencoding::encode(query));
    if page > 1 {
        format!("{url}?page={page}")
    } else {
        url
    }
}

pub fn search_api_url(query: &str, page: u64) -> String {
    format!(
        "https://crates.io/api/v1/crates?q={}&per_page={PAGE_SIZE}&page={}",
        urlencoding::encode(query.trim()),
        page.max(1),
    )
}

pub async fn fetch_search(query: &str, page: u64) -> Result<SearchResponse, String> {
    let response = Request::get(&search_api_url(query, page))
        .send()
        .await
        .map_err(|_| {
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
        .map_err(|_| "Could not read the crates.io search response. Please try again.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_urls_preserve_query_text_and_reset_pagination() {
        let query = " rust / async + café? & ";
        assert_eq!(
            search_url(query, 1),
            "/search/rust%20%2F%20async%20%2B%20caf%C3%A9%3F%20%26"
        );
        assert_eq!(search_url("serde", 2), "/search/serde?page=2");
        assert_eq!(search_url("   ", 4), "/");
        assert_eq!(
            search_api_url("a&b", 0),
            "https://crates.io/api/v1/crates?q=a%26b&per_page=20&page=1"
        );
    }

    #[test]
    fn search_response_reads_crates_and_total() {
        let response: SearchResponse = serde_json::from_value(serde_json::json!({
            "crates": [{
                "id": "serde", "max_version": "1.0.219", "downloads": 100,
                "description": null, "repository": null, "documentation": null
            }],
            "meta": { "total": 42, "next_page": "?page=2" }
        }))
        .unwrap();
        assert_eq!(response.crates[0].id, "serde");
        assert_eq!(response.meta.total, 42);
    }
}
