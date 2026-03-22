use std::sync::Arc;
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::audit::AuditEntry;
use crate::auth::authenticate;
use crate::blocklist::is_allowed;
use crate::config::AgentConfig;
use crate::permissions::has_permission;
use crate::state::{AppState, HEARTBEAT_INTERVAL_SECS, STALE_CONNECTION_SECS};

// ── Typed Protocol Messages ──────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    Auth { token: String, agent_id: String },
    Ping,
    Pong,
    #[serde(other)]
    Action,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    Error { code: String, message: String, #[serde(skip_serializing_if = "Option::is_none")] request_id: Option<serde_json::Value> },
    Result { action: String, ok: bool, #[serde(skip_serializing_if = "Option::is_none")] data: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] request_id: Option<serde_json::Value>, #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")] mime_type: Option<String> },
    Ping,
}

// ── Helpers ──────────────────────────────────────────────────────────

fn error_msg(code: &str, message: &str, request_id: Option<serde_json::Value>) -> String {
    serde_json::to_string(&OutgoingMessage::Error {
        code: code.to_string(),
        message: message.to_string(),
        request_id,
    }).expect("OutgoingMessage serialization cannot fail")
}

fn result_msg(action: &str, data: Option<String>, request_id: Option<serde_json::Value>, mime_type: Option<String>) -> String {
    serde_json::to_string(&OutgoingMessage::Result {
        action: action.to_string(),
        ok: true,
        data,
        request_id,
        mime_type,
    }).expect("OutgoingMessage serialization cannot fail")
}

fn ping_msg() -> String {
    serde_json::to_string(&OutgoingMessage::Ping).expect("OutgoingMessage serialization cannot fail")
}

// ── WebSocket Handler ────────────────────────────────────────────────

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

    // Phase 1: Authentication
    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => return,
            Err(_) => return,
            _ => continue,
        };

        let parsed: serde_json::Value = match serde_json::from_str(&msg) {
            Ok(v) => v,
            Err(_) => {
                let _ = sender.send(Message::Text(
                    error_msg("invalid_message", "Could not parse message", None).into()
                )).await;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if msg_type != "auth" {
            let _ = sender.send(Message::Text(
                error_msg("not_authenticated", "Send auth message first", None).into()
            )).await;
            continue;
        }

        let token = parsed.get("token").and_then(|v| v.as_str()).unwrap_or("");
        let aid = parsed.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");

        let config = state.config.read().expect("config lock poisoned").clone();
        match authenticate(&config, token, aid) {
            None => {
                let _ = sender.send(Message::Text(
                    error_msg("auth_failed", "Invalid token or agent_id", None).into()
                )).await;
                return;
            }
            Some(cfg) => {
                if state.is_agent_connected(aid) {
                    let _ = sender.send(Message::Text(
                        error_msg("duplicate_agent", "Agent ID already connected", None).into()
                    )).await;
                    return;
                }
                authenticated = true;
                agent_id = Some(aid.to_string());
                agent_config = Some(cfg);
                state.agent_connected(aid);
                let _ = sender.send(Message::Text(
                    result_msg("auth", None, None, None).into()
                )).await;
                break;
            }
        }
    }

    if !authenticated {
        return;
    }

    let aid = agent_id.expect("agent_id must be Some after successful authentication");
    let cfg = agent_config.expect("agent_config must be Some after successful authentication");

    // Heartbeat: wrap sender in Arc<Mutex> for sharing with ping task
    let sender = Arc::new(tokio::sync::Mutex::new(sender));
    let last_pong = Arc::new(tokio::sync::Mutex::new(std::time::Instant::now()));

    // Spawn ping loop
    let ping_sender = sender.clone();
    let ping_pong = last_pong.clone();
    let ping_aid = aid.clone();
    let ping_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let elapsed = ping_pong.lock().await.elapsed();
            if elapsed > std::time::Duration::from_secs(STALE_CONNECTION_SECS) {
                tracing::warn!("Agent {} heartbeat timeout, disconnecting", ping_aid);
                let mut s = ping_sender.lock().await;
                let _ = s.close().await;
                break;
            }
            let mut s = ping_sender.lock().await;
            if s.send(Message::Text(ping_msg().into())).await.is_err() {
                break;
            }
        }
    });

    // Phase 2: Action loop
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
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(
                    error_msg("invalid_message", "Could not parse message", None).into()
                )).await;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let req_id = parsed.get("request_id").cloned();

        // Handle pong
        if msg_type == "pong" {
            *last_pong.lock().await = std::time::Instant::now();
            continue;
        }

        let action = msg_type;

        let valid_actions = ["snapshot", "screenshot", "click", "type", "fill", "navigate", 
                            "press", "hover", "select", "evaluate", "close"];
        if !valid_actions.contains(&action) {
            let mut s = sender.lock().await;
            let _ = s.send(Message::Text(
                error_msg("invalid_action", "Unknown action type", req_id).into()
            )).await;
            continue;
        }

        // Permission check
        if !has_permission(&cfg.scopes, action) {
            let mut s = sender.lock().await;
            let _ = s.send(Message::Text(
                error_msg("permission_denied", &format!("Agent lacks required scope for '{}'", action), req_id).into()
            )).await;
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: aid.clone(), action: action.to_string(),
                target: None, ok: false, duration_ms: 0,
                error: Some("permission_denied".to_string()),
            });
            continue;
        }

        // Rate limit
        if !state.check_rate_limit(&aid, cfg.rate_limit) {
            let mut s = sender.lock().await;
            let _ = s.send(Message::Text(
                error_msg("rate_limited", "Rate limit exceeded", req_id).into()
            )).await;
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: aid.clone(), action: action.to_string(),
                target: None, ok: false, duration_ms: 0,
                error: Some("rate_limited".to_string()),
            });
            continue;
        }

        // URL allowlist/blocklist check for navigate
        let config = state.config.read().expect("config lock poisoned").clone();
        if action == "navigate" {
            if let Some(url) = parsed.get("url").and_then(|v| v.as_str()) {
                let check = is_allowed(url, &cfg.allowlist, &config.blocklist);
                if !check.allowed {
                    let reason = check.reason.unwrap_or_else(|| "Site blocked".to_string());
                    let mut s = sender.lock().await;
                    let _ = s.send(Message::Text(
                        error_msg("site_blocked", &reason, req_id).into()
                    )).await;
                    state.audit.log(AuditEntry {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        agent_id: aid.clone(), action: action.to_string(),
                        target: Some(url.to_string()), ok: false, duration_ms: 0,
                        error: Some("site_blocked".to_string()),
                    });
                    continue;
                }
            }
        } else if action != "close" {
            // Check current page URL against blocklist for non-navigate, non-close actions
            let url_result = execute_engine(&config.engine.binary, &["get".to_string(), "url".to_string()], config.engine.timeout).await;
            if let Ok(current_url) = url_result {
                if !current_url.is_empty() {
                    let check = is_allowed(&current_url, &cfg.allowlist, &config.blocklist);
                    if !check.allowed {
                        let reason = check.reason.unwrap_or_else(|| "Current site is blocked".to_string());
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(
                            error_msg("site_blocked", &reason, req_id).into()
                        )).await;
                        state.audit.log(AuditEntry {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            agent_id: aid.clone(), action: action.to_string(),
                            target: Some(current_url), ok: false, duration_ms: 0,
                            error: Some("site_blocked".to_string()),
                        });
                        continue;
                    }
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

        state.agent_action(&aid, action);
        
        match result {
            Ok(data) => {
                state.audit.log(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    agent_id: aid.clone(), action: action.to_string(),
                    target, ok: true, duration_ms: duration, error: None,
                });

                // Screenshot tunneling: read the file and send as base64
                if action == "screenshot" && !data.is_empty() {
                    let screenshot_path = data.split_whitespace()
                        .find(|s| s.starts_with('/') && s.ends_with(".png"));
                    if let Some(screenshot_path) = screenshot_path {
                        match tokio::fs::read(screenshot_path).await {
                            Ok(bytes) => {
                                use base64::Engine as _;
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                                let mut s = sender.lock().await;
                                let _ = s.send(Message::Text(
                                    result_msg("screenshot", Some(b64), req_id, Some("image/png".to_string())).into()
                                )).await;
                                continue;
                            }
                            Err(e) => {
                                eprintln!("Screenshot tunnel error: {} (path: {})", e, screenshot_path);
                                // Fall through to normal response
                            }
                        }
                    }
                }

                let resp_data = if data.is_empty() { None } else { Some(data) };
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(
                    result_msg(action, resp_data, req_id, None).into()
                )).await;
            }
            Err(e) => {
                state.audit.log(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    agent_id: aid.clone(), action: action.to_string(),
                    target, ok: false, duration_ms: duration,
                    error: Some(e.clone()),
                });
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(
                    error_msg("engine_error", &e, req_id).into()
                )).await;
            }
        }
    }

    // Cleanup
    ping_handle.abort();
    state.agent_disconnected(&aid);
    tracing::info!("Agent {} disconnected", aid);
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
