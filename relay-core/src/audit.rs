use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub agent_id: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub ok: bool,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct AuditLogger {
    log_file: String,
    log_to_stdout: bool,
    entries: Arc<RwLock<Vec<AuditEntry>>>,
}

impl AuditLogger {
    pub fn new(log_file: &str, log_to_stdout: bool) -> Self {
        Self {
            log_file: log_file.to_string(),
            log_to_stdout,
            entries: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn log(&self, entry: AuditEntry) {
        let line = serde_json::to_string(&entry).unwrap_or_default();
        
        // Write to file
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.log_file) {
            let _ = writeln!(f, "{}", line);
        }
        
        if self.log_to_stdout {
            println!("{}", line);
        }

        if let Ok(mut entries) = self.entries.write() {
            entries.push(entry);
            if entries.len() > 1000 {
                let drain = entries.len() - 1000;
                entries.drain(..drain);
            }
        }
    }

    #[allow(dead_code)]
    pub fn get_entries(&self) -> Vec<AuditEntry> {
        self.entries.read().map(|e| e.clone()).unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
        let _ = fs::write(&self.log_file, "");
    }

    pub fn read_from_file(&self) -> Vec<AuditEntry> {
        let content = fs::read_to_string(&self.log_file).unwrap_or_default();
        content.lines()
            .filter(|l| !l.is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect::<Vec<AuditEntry>>()
            .into_iter()
            .rev()
            .take(100)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_entry(action: &str) -> AuditEntry {
        AuditEntry {
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            agent_id: "test".to_string(),
            action: action.to_string(),
            target: None,
            ok: true,
            duration_ms: 10,
            error: None,
        }
    }

    #[test]
    fn test_log_and_get_entries() {
        let tmp = std::env::temp_dir().join("test-audit.jsonl");
        let logger = AuditLogger::new(tmp.to_str().unwrap(), false);
        logger.log(test_entry("click"));
        logger.log(test_entry("snapshot"));
        let entries = logger.get_entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].action, "click");
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_clear() {
        let tmp = std::env::temp_dir().join("test-audit-clear.jsonl");
        let logger = AuditLogger::new(tmp.to_str().unwrap(), false);
        logger.log(test_entry("click"));
        logger.clear();
        assert!(logger.get_entries().is_empty());
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_read_from_file() {
        let tmp = std::env::temp_dir().join("test-audit-read.jsonl");
        let logger = AuditLogger::new(tmp.to_str().unwrap(), false);
        logger.log(test_entry("navigate"));
        let from_file = logger.read_from_file();
        assert_eq!(from_file.len(), 1);
        assert_eq!(from_file[0].action, "navigate");
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_read_from_file_empty() {
        let tmp = std::env::temp_dir().join("test-audit-empty.jsonl");
        std::fs::write(&tmp, "").ok();
        let logger = AuditLogger::new(tmp.to_str().unwrap(), false);
        assert!(logger.read_from_file().is_empty());
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_entry_with_error() {
        let entry = AuditEntry {
            timestamp: "2025-01-01T00:00:00Z".to_string(),
            agent_id: "test".to_string(),
            action: "click".to_string(),
            target: Some("ref1".to_string()),
            ok: false,
            duration_ms: 5,
            error: Some("permission_denied".to_string()),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("permission_denied"));
        assert!(json.contains("ref1"));
    }

    #[test]
    fn test_entry_serialization_skips_none() {
        let entry = test_entry("snapshot");
        let json = serde_json::to_string(&entry).unwrap();
        assert!(!json.contains("target"));
        assert!(!json.contains("error"));
    }
}
