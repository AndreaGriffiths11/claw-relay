use crate::config::Config;
use std::collections::HashMap;
use std::sync::RwLock;
use crate::audit::AuditLogger;

/// Heartbeat ping interval in seconds
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;
/// Stale connection timeout in seconds (no pong received)
pub const STALE_CONNECTION_SECS: u64 = 90;
/// Rate limit window in milliseconds
pub const RATE_WINDOW_MS: u64 = 60_000;
/// Cleanup interval for stale rate limit buckets in seconds
pub const CLEANUP_INTERVAL_SECS: u64 = 60;
/// Rate limit bucket expiry in milliseconds (5 minutes)
pub const BUCKET_EXPIRY_MS: u64 = 5 * 60 * 1000;
/// Maximum audit entries kept in memory
#[allow(dead_code)]
pub const MAX_AUDIT_ENTRIES: usize = 1000;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentState {
    pub agent_id: String,
    pub connected_at: String,
    pub last_action: Option<String>,
    pub last_action_at: Option<String>,
    pub action_count: u64,
}

pub struct AppState {
    pub config: RwLock<Config>,
    pub config_path: String,
    pub connections: RwLock<HashMap<String, AgentState>>,
    pub started_at: String,
    pub audit: AuditLogger,
    pub rate_limits: RwLock<HashMap<String, RateBucket>>,
}

pub struct RateBucket {
    pub count: u32,
    pub last_reset: u64,
}

impl AppState {
    pub fn new(config: Config, config_path: String) -> std::sync::Arc<Self> {
        let audit = AuditLogger::new(&config.audit.log_file, config.audit.log_to_stdout);
        std::sync::Arc::new(Self {
            config: RwLock::new(config),
            config_path,
            connections: RwLock::new(HashMap::new()),
            started_at: chrono::Utc::now().to_rfc3339(),
            audit,
            rate_limits: RwLock::new(HashMap::new()),
        })
    }

    /// Spawns a background task that cleans up stale rate limit entries.
    pub fn start_cleanup_task(state: std::sync::Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(CLEANUP_INTERVAL_SECS));
            loop {
                interval.tick().await;
                state.cleanup_stale_rate_limits();
            }
        });
    }

    fn cleanup_stale_rate_limits(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before UNIX epoch")
            .as_millis() as u64;
        let mut buckets = self.rate_limits.write().expect("rate_limits lock poisoned");
        buckets.retain(|_, bucket| now - bucket.last_reset < BUCKET_EXPIRY_MS);
    }

    pub fn agent_connected(&self, agent_id: &str) {
        let mut conns = self.connections.write().expect("connections lock poisoned");
        conns.insert(agent_id.to_string(), AgentState {
            agent_id: agent_id.to_string(),
            connected_at: chrono::Utc::now().to_rfc3339(),
            last_action: None,
            last_action_at: None,
            action_count: 0,
        });
    }

    pub fn agent_disconnected(&self, agent_id: &str) {
        let mut conns = self.connections.write().expect("connections lock poisoned");
        conns.remove(agent_id);
    }

    pub fn agent_action(&self, agent_id: &str, action: &str) {
        let mut conns = self.connections.write().expect("connections lock poisoned");
        if let Some(state) = conns.get_mut(agent_id) {
            state.last_action = Some(action.to_string());
            state.last_action_at = Some(chrono::Utc::now().to_rfc3339());
            state.action_count += 1;
        }
    }

    pub fn check_rate_limit(&self, agent_id: &str, limit: u32) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before UNIX epoch")
            .as_millis() as u64;
        let mut buckets = self.rate_limits.write().expect("rate_limits lock poisoned");
        let bucket = buckets.entry(agent_id.to_string()).or_insert(RateBucket {
            count: 0,
            last_reset: now,
        });
        if now - bucket.last_reset >= RATE_WINDOW_MS {
            bucket.count = 0;
            bucket.last_reset = now;
        }
        if bucket.count >= limit {
            return false;
        }
        bucket.count += 1;
        true
    }

    pub fn is_agent_connected(&self, agent_id: &str) -> bool {
        self.connections.read().expect("connections lock poisoned").contains_key(agent_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, ServerConfig, AuditConfig, EngineConfig, DashboardConfig};

    fn test_config() -> Config {
        Config {
            server: ServerConfig::default(),
            agents: HashMap::new(),
            blocklist: vec![],
            audit: AuditConfig { log_file: "/dev/null".to_string(), log_to_stdout: false },
            engine: EngineConfig::default(),
            dashboard: DashboardConfig::default(),
        }
    }

    #[test]
    fn test_agent_connect_disconnect() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        assert!(!state.is_agent_connected("agent1"));
        state.agent_connected("agent1");
        assert!(state.is_agent_connected("agent1"));
        state.agent_disconnected("agent1");
        assert!(!state.is_agent_connected("agent1"));
    }

    #[test]
    fn test_agent_action_tracking() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        state.agent_connected("agent1");
        state.agent_action("agent1", "click");
        let conns = state.connections.read().unwrap();
        let agent = conns.get("agent1").unwrap();
        assert_eq!(agent.action_count, 1);
        assert_eq!(agent.last_action.as_deref(), Some("click"));
    }

    #[test]
    fn test_rate_limit_allows_under_limit() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        for _ in 0..5 {
            assert!(state.check_rate_limit("agent1", 10));
        }
    }

    #[test]
    fn test_rate_limit_blocks_over_limit() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        for _ in 0..10 {
            state.check_rate_limit("agent1", 10);
        }
        assert!(!state.check_rate_limit("agent1", 10));
    }

    #[test]
    fn test_rate_limit_separate_agents() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        for _ in 0..10 {
            state.check_rate_limit("agent1", 10);
        }
        assert!(!state.check_rate_limit("agent1", 10));
        assert!(state.check_rate_limit("agent2", 10));
    }

    #[test]
    fn test_cleanup_stale_rate_limits() {
        let state = AppState::new(test_config(), "/dev/null".to_string());
        // Insert a bucket with an old timestamp
        {
            let mut buckets = state.rate_limits.write().unwrap();
            buckets.insert("stale_agent".to_string(), RateBucket {
                count: 5,
                last_reset: 0, // epoch — definitely stale
            });
        }
        state.cleanup_stale_rate_limits();
        let buckets = state.rate_limits.read().unwrap();
        assert!(!buckets.contains_key("stale_agent"));
    }

    #[test]
    fn test_constants_values() {
        assert_eq!(HEARTBEAT_INTERVAL_SECS, 30);
        assert_eq!(STALE_CONNECTION_SECS, 90);
        assert_eq!(RATE_WINDOW_MS, 60_000);
        assert_eq!(CLEANUP_INTERVAL_SECS, 60);
        assert_eq!(BUCKET_EXPIRY_MS, 300_000);
        assert_eq!(MAX_AUDIT_ENTRIES, 1000);
    }
}
