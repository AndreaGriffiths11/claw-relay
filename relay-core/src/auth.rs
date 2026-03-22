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
#[allow(dead_code)]
pub fn extract_admin_token(headers: &axum::http::HeaderMap) -> Option<String> {
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
    let a = Sha256::digest(admin_token.as_bytes());
    let b = Sha256::digest(provided.as_bytes());
    constant_time_eq(&a, &b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, AgentConfig, ServerConfig, AuditConfig, EngineConfig, DashboardConfig};
    use std::collections::HashMap;

    fn test_config() -> Config {
        let mut agents = HashMap::new();
        agents.insert("test-agent".to_string(), AgentConfig {
            token: "secret-token-123".to_string(),
            scopes: vec!["read".to_string()],
            allowlist: vec!["*".to_string()],
            rate_limit: 30,
        });
        Config {
            server: ServerConfig::default(),
            agents,
            blocklist: vec![],
            audit: AuditConfig::default(),
            engine: EngineConfig::default(),
            dashboard: DashboardConfig::default(),
        }
    }

    #[test]
    fn test_authenticate_valid() {
        let config = test_config();
        let result = authenticate(&config, "secret-token-123", "test-agent");
        assert!(result.is_some());
    }

    #[test]
    fn test_authenticate_wrong_token() {
        let config = test_config();
        let result = authenticate(&config, "wrong-token", "test-agent");
        assert!(result.is_none());
    }

    #[test]
    fn test_authenticate_unknown_agent() {
        let config = test_config();
        let result = authenticate(&config, "secret-token-123", "unknown");
        assert!(result.is_none());
    }

    #[test]
    fn test_authenticate_empty_token() {
        let config = test_config();
        assert!(authenticate(&config, "", "test-agent").is_none());
    }

    #[test]
    fn test_check_admin_auth_valid() {
        assert!(check_admin_auth("admin-secret", "admin-secret"));
    }

    #[test]
    fn test_check_admin_auth_wrong() {
        assert!(!check_admin_auth("admin-secret", "wrong"));
    }

    #[test]
    fn test_check_admin_auth_empty() {
        assert!(!check_admin_auth("", "anything"));
    }

    #[test]
    fn test_constant_time_eq_same() {
        assert!(constant_time_eq(b"hello", b"hello"));
    }

    #[test]
    fn test_constant_time_eq_different() {
        assert!(!constant_time_eq(b"hello", b"world"));
    }

    #[test]
    fn test_constant_time_eq_different_lengths() {
        assert!(!constant_time_eq(b"short", b"longer string"));
    }
}
