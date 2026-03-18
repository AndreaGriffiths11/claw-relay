use std::sync::Arc;
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use tokio::process::Command;

use crate::audit::AuditEntry;
use crate::auth::authenticate;
use crate::blocklist::is_allowed;
use crate::config::AgentConfig;
use crate::permissions::has_permission;
use crate::state::AppState;

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    
    let mut authenticated = false;
    let mut agent_id: Option<String> = None;
    let mut agent_config: Option<AgentConfig> = None;

    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => continue,
        };

        let parsed: serde_json::Value = match serde_json::from_str(&msg) {
            Ok(v) => v,
            Err(_) => {
                let _ = sender.send(Message::Text(serde_json::json!({
                    "type": "error", "code": "invalid_message", "message": "Could not parse message"
                }).to_string().into())).await;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if !authenticated {
            if msg_type != "auth" {
                let _ = sender.send(Message::Text(serde_json::json!({
                    "type": "error", "code": "not_authenticated", "message": "Send auth message first"
                }).to_string().into())).await;
                continue;
            }

            let token = parsed.get("token").and_then(|v| v.as_str()).unwrap_or("");
            let aid = parsed.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");

            let config = state.config.read().unwrap().clone();
            match authenticate(&config, token, aid) {
                None => {
                    let _ = sender.send(Message::Text(serde_json::json!({
                        "type": "error", "code": "auth_failed", "message": "Invalid token or agent_id"
                    }).to_string().into())).await;
                    break;
                }
                Some(cfg) => {
                    // Check duplicate
                    if state.is_agent_connected(aid) {
                        let _ = sender.send(Message::Text(serde_json::json!({
                            "type": "error", "code": "duplicate_agent", "message": "Agent ID already connected"
                        }).to_string().into())).await;
                        break;
                    }
                    authenticated = true;
                    agent_id = Some(aid.to_string());
                    agent_config = Some(cfg);
                    state.agent_connected(aid);
                    let _ = sender.send(Message::Text(serde_json::json!({
                        "type": "result", "action": "auth", "ok": true
                    }).to_string().into())).await;
                }
            }
            continue;
        }

        // Action handling
        let aid = agent_id.as_ref().unwrap();
        let cfg = agent_config.as_ref().unwrap();
        let action = msg_type;

        let valid_actions = ["snapshot", "screenshot", "click", "type", "fill", "navigate", 
                            "press", "hover", "select", "evaluate", "close"];
        if !valid_actions.contains(&action) {
            let _ = sender.send(Message::Text(serde_json::json!({
                "type": "error", "code": "invalid_action", "message": "Unknown action type"
            }).to_string().into())).await;
            continue;
        }

        // Permission check
        if !has_permission(&cfg.scopes, action) {
            let _ = sender.send(Message::Text(serde_json::json!({
                "type": "error", "code": "permission_denied", 
                "message": format!("Agent lacks required scope for '{}'", action)
            }).to_string().into())).await;
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: aid.clone(), action: action.to_string(),
                target: None, ok: false, duration_ms: 0,
                error: Some("permission_denied".to_string()),
            });
            continue;
        }

        // Rate limit
        if !state.check_rate_limit(aid, cfg.rate_limit) {
            let _ = sender.send(Message::Text(serde_json::json!({
                "type": "error", "code": "rate_limited", "message": "Rate limit exceeded"
            }).to_string().into())).await;
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: aid.clone(), action: action.to_string(),
                target: None, ok: false, duration_ms: 0,
                error: Some("rate_limited".to_string()),
            });
            continue;
        }

        // URL allowlist check
        let config = state.config.read().unwrap().clone();
        if action == "navigate" {
            if let Some(url) = parsed.get("url").and_then(|v| v.as_str()) {
                let check = is_allowed(url, &cfg.allowlist, &config.blocklist);
                if !check.allowed {
                    let reason = check.reason.unwrap_or_else(|| "Site blocked".to_string());
                    let _ = sender.send(Message::Text(serde_json::json!({
                        "type": "error", "code": "site_blocked", "message": reason
                    }).to_string().into())).await;
                    state.audit.log(AuditEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        agent_id: aid.clone(), action: action.to_string(),
                        target: Some(url.to_string()), ok: false, duration_ms: 0,
                        error: Some("site_blocked".to_string()),
                    });
                    continue;
                }
            }
        }

        // Execute via engine
        let start = std::time::Instant::now();
        let args = build_engine_args(action, &parsed);
        let result = execute_engine(&config.engine.binary, &args, config.engine.timeout).await;
        let duration = start.elapsed().as_millis() as u64;

        let target = parsed.get("ref").and_then(|v| v.as_str())
            .or_else(|| parsed.get("url").and_then(|v| v.as_str()))
            .or_else(|| parsed.get("key").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        state.agent_action(aid, action);
        
        match result {
            Ok(data) => {
                state.audit.log(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    agent_id: aid.clone(), action: action.to_string(),
                    target, ok: true, duration_ms: duration, error: None,
                });
                let mut resp = serde_json::json!({"type": "result", "action": action, "ok": true});
                if !data.is_empty() {
                    resp["data"] = serde_json::Value::String(data);
                }
                let _ = sender.send(Message::Text(resp.to_string().into())).await;
            }
            Err(e) => {
                state.audit.log(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    agent_id: aid.clone(), action: action.to_string(),
                    target, ok: false, duration_ms: duration,
                    error: Some(e.clone()),
                });
                let _ = sender.send(Message::Text(serde_json::json!({
                    "type": "error", "code": "engine_error", "message": e
                }).to_string().into())).await;
            }
        }
    }

    // Cleanup
    if let Some(aid) = &agent_id {
        state.agent_disconnected(aid);
        tracing::info!("Agent {} disconnected", aid);
    }
}

fn build_engine_args(action: &str, msg: &serde_json::Value) -> Vec<String> {
    match action {
        "snapshot" => vec!["snapshot".to_string()],
        "screenshot" => vec!["screenshot".to_string()],
        "close" => vec!["close".to_string()],
        "click" => vec!["click".to_string(), msg.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "hover" => vec!["hover".to_string(), msg.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "fill" => vec!["fill".to_string(), 
            msg.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            msg.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "type" => vec!["type".to_string(),
            msg.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            msg.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "press" => vec!["press".to_string(), msg.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "navigate" => vec!["open".to_string(), msg.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "evaluate" => vec!["eval".to_string(), msg.get("js").and_then(|v| v.as_str()).unwrap_or("").to_string()],
        "select" => {
            let mut args = vec!["select".to_string(), msg.get("ref").and_then(|v| v.as_str()).unwrap_or("").to_string()];
            if let Some(values) = msg.get("values").and_then(|v| v.as_array()) {
                for v in values {
                    if let Some(s) = v.as_str() {
                        args.push(s.to_string());
                    }
                }
            }
            args
        }
        _ => vec![],
    }
}

async fn execute_engine(binary: &str, args: &[String], timeout_ms: u64) -> Result<String, String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        Command::new(binary).args(args).output(),
    ).await;

    match result {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                Err(if stderr.is_empty() { format!("Exit code: {}", output.status) } else { stderr })
            }
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("Engine timeout".to_string()),
    }
}

pub fn create_ws_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(ws_handler))
        .with_state(state)
}
