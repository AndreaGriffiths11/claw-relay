use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_host")]
    pub host: String,
}

fn default_port() -> u16 { 9333 }
fn default_host() -> String { "127.0.0.1".to_string() }

impl Default for ServerConfig {
    fn default() -> Self {
        Self { port: default_port(), host: default_host() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub token: String,
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    #[serde(default = "default_allowlist")]
    pub allowlist: Vec<String>,
    #[serde(default = "default_rate_limit")]
    pub rate_limit: u32,
}

fn default_scopes() -> Vec<String> { vec!["read".to_string()] }
fn default_allowlist() -> Vec<String> { vec!["*".to_string()] }
fn default_rate_limit() -> u32 { 30 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditConfig {
    #[serde(default = "default_log_file")]
    pub log_file: String,
    #[serde(default = "default_log_to_stdout")]
    pub log_to_stdout: bool,
}

fn default_log_file() -> String { "./audit.jsonl".to_string() }
fn default_log_to_stdout() -> bool { true }

impl Default for AuditConfig {
    fn default() -> Self {
        Self { log_file: default_log_file(), log_to_stdout: default_log_to_stdout() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    #[serde(default = "default_binary")]
    pub binary: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_binary() -> String { "agent-browser".to_string() }
fn default_timeout() -> u64 { 30000 }

impl Default for EngineConfig {
    fn default() -> Self {
        Self { binary: default_binary(), timeout: default_timeout() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardConfig {
    #[serde(default = "default_dashboard_port")]
    pub port: u16,
    #[serde(default)]
    pub admin_token: String,
}

fn default_dashboard_port() -> u16 { 9334 }

impl Default for DashboardConfig {
    fn default() -> Self {
        Self { port: default_dashboard_port(), admin_token: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub agents: HashMap<String, AgentConfig>,
    #[serde(default)]
    pub blocklist: Vec<String>,
    #[serde(default)]
    pub audit: AuditConfig,
    #[serde(default)]
    pub engine: EngineConfig,
    #[serde(default)]
    pub dashboard: DashboardConfig,
}

pub fn load_config(path: &str) -> Result<Config, Box<dyn std::error::Error>> {
    let raw = fs::read_to_string(path)?;
    let config: Config = serde_yaml::from_str(&raw)?;
    Ok(config)
}

pub fn write_config_atomic(path: &str, config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let yaml = serde_yaml::to_string(config)?;
    let tmp = format!("{}.tmp.{}", path, chrono::Utc::now().timestamp_millis());
    fs::write(&tmp, &yaml)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn redact_token(token: &str) -> String {
    if token.len() <= 4 {
        "****".to_string()
    } else {
        format!("****{}", &token[token.len()-4..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_token_long() {
        assert_eq!(redact_token("my-secret-token"), "****oken");
    }

    #[test]
    fn test_redact_token_short() {
        assert_eq!(redact_token("abc"), "****");
    }

    #[test]
    fn test_redact_token_exactly_4() {
        assert_eq!(redact_token("abcd"), "****");
    }

    #[test]
    fn test_redact_token_5_chars() {
        assert_eq!(redact_token("abcde"), "****bcde");
    }

    #[test]
    fn test_defaults() {
        assert_eq!(default_port(), 9333);
        assert_eq!(default_host(), "127.0.0.1");
        assert_eq!(default_rate_limit(), 30);
        assert_eq!(default_dashboard_port(), 9334);
        assert_eq!(default_scopes(), vec!["read".to_string()]);
        assert_eq!(default_allowlist(), vec!["*".to_string()]);
    }

    #[test]
    fn test_load_config_yaml() {
        let yaml = r#"
server:
  port: 8080
  host: "0.0.0.0"
agents:
  test:
    token: "test-token-12345"
    scopes: ["read", "interact"]
blocklist:
  - "evil.com"
"#;
        let tmp = std::env::temp_dir().join("test-config.yaml");
        std::fs::write(&tmp, yaml).unwrap();
        let config = load_config(tmp.to_str().unwrap()).unwrap();
        assert_eq!(config.server.port, 8080);
        assert_eq!(config.server.host, "0.0.0.0");
        assert!(config.agents.contains_key("test"));
        assert_eq!(config.blocklist, vec!["evil.com".to_string()]);
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_load_config_missing_file() {
        assert!(load_config("/nonexistent/path.yaml").is_err());
    }

    #[test]
    fn test_write_config_atomic() {
        let config = Config {
            server: ServerConfig::default(),
            agents: std::collections::HashMap::new(),
            blocklist: vec![],
            audit: AuditConfig::default(),
            engine: EngineConfig::default(),
            dashboard: DashboardConfig::default(),
        };
        let tmp = std::env::temp_dir().join("test-write-config.yaml");
        write_config_atomic(tmp.to_str().unwrap(), &config).unwrap();
        let reloaded = load_config(tmp.to_str().unwrap()).unwrap();
        assert_eq!(reloaded.server.port, 9333);
        std::fs::remove_file(&tmp).ok();
    }
}
