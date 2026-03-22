use crate::config::Config;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use crate::audit::AuditLogger;

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
    pub fn new(config: Config, config_path: String) -> Arc<Self> {
        let audit = AuditLogger::new(&config.audit.log_file, config.audit.log_to_stdout);
        Arc::new(Self {
            config: RwLock::new(config),
            config_path,
            connections: RwLock::new(HashMap::new()),
            started_at: chrono::Utc::now().to_rfc3339(),
            audit,
            rate_limits: RwLock::new(HashMap::new()),
        })
    }

    /// Spawns a background task that cleans up stale rate limit entries every 60 seconds.
    pub fn start_cleanup_task(state: Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                state.cleanup_stale_rate_limits();
            }
        });
    }

    fn cleanup_stale_rate_limits(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let stale_threshold = 5 * 60 * 1000; // 5 minutes in ms
        let mut buckets = self.rate_limits.write().unwrap();
        buckets.retain(|_, bucket| now - bucket.last_reset < stale_threshold);
    }

    pub fn agent_connected(&self, agent_id: &str) {
        let mut conns = self.connections.write().unwrap();
        conns.insert(agent_id.to_string(), AgentState {
            agent_id: agent_id.to_string(),
            connected_at: chrono::Utc::now().to_rfc3339(),
            last_action: None,
            last_action_at: None,
            action_count: 0,
        });
    }

    pub fn agent_disconnected(&self, agent_id: &str) {
        let mut conns = self.connections.write().unwrap();
        conns.remove(agent_id);
    }

    pub fn agent_action(&self, agent_id: &str, action: &str) {
        let mut conns = self.connections.write().unwrap();
        if let Some(state) = conns.get_mut(agent_id) {
            state.last_action = Some(action.to_string());
            state.last_action_at = Some(chrono::Utc::now().to_rfc3339());
            state.action_count += 1;
        }
    }

    pub fn check_rate_limit(&self, agent_id: &str, limit: u32) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let mut buckets = self.rate_limits.write().unwrap();
        let bucket = buckets.entry(agent_id.to_string()).or_insert(RateBucket {
            count: 0,
            last_reset: now,
        });
        if now - bucket.last_reset >= 60000 {
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
        self.connections.read().unwrap().contains_key(agent_id)
    }
}
