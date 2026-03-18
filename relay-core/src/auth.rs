use sha2::{Sha256, Digest};
use crate::config::{AgentConfig, Config};

/// Timing-safe token comparison using SHA-256 hashes
pub fn authenticate(config: &Config, token: &str, agent_id: &str) -> Option<AgentConfig> {
    let agent = config.agents.get(agent_id)?;
    let a = Sha256::digest(agent.token.as_bytes());
    let b = Sha256::digest(token.as_bytes());
    // Constant-time compare
    if constant_time_eq(&a, &b) {
        Some(agent.clone())
    } else {
        None
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Extract admin token from query string or Authorization header
pub fn extract_admin_token(query: Option<&str>, headers: &axum::http::HeaderMap) -> Option<String> {
    // Check query param
    if let Some(q) = query {
        for pair in q.split('&') {
            let mut parts = pair.splitn(2, '=');
            if let (Some(key), Some(val)) = (parts.next(), parts.next()) {
                if key == "token" {
                    return Some(val.to_string());
                }
            }
        }
    }
    // Check Authorization header
    if let Some(auth) = headers.get("authorization") {
        if let Ok(val) = auth.to_str() {
            if let Some(token) = val.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    None
}

pub fn check_admin_auth(admin_token: &str, provided: &str) -> bool {
    if admin_token.is_empty() { return false; }
    constant_time_eq(admin_token.as_bytes(), provided.as_bytes())
}
