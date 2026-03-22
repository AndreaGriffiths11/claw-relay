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
            // Keep last 1000 in memory
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
