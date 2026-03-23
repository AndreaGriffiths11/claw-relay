// WebSocket relay — the core of Claw Relay's Rust implementation.
// Handles agent connections through a two-phase protocol:
// Phase 1 (auth): agent sends token + agent_id, gets validated
// Phase 2 (action loop): authenticated agent sends browser actions,
// relay checks permissions/rate limits/URL restrictions before executing

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

// ── Wire Protocol Types ──────────────────────────────────────────────
// These map 1:1 to the JSON messages on the WebSocket.
// See docs/protocol.md for the full spec.

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
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        request_id: Option<serde_json::Value>,
    },
    Result {
        action: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        request_id: Option<serde_json::Value>,
        #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
    },
    Ping,
}

// ── Message Constructors ─────────────────────────────────────────────
// Serialize directly to String — callers never need the enum variant.

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

// ── WebSocket Entry Point ────────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    // Phase 1: Wait for a valid auth message before accepting any actions
    let (aid, cfg) = match authenticate_agent(&mut sender, &mut receiver, &state).await {
        Some(result) => result,
        None => return,
    };

    // Wrap sender for sharing with the heartbeat task
    let sender = Arc::new(tokio::sync::Mutex::new(sender));
    let last_pong = Arc::new(tokio::sync::Mutex::new(std::time::Instant::now()));

    // Heartbeat: detect zombie connections that silently drop
    let ping_handle = spawn_heartbeat(sender.clone(), last_pong.clone(), aid.clone());

    // Phase 2: Process actions until disconnect
    run_action_loop(&mut receiver, &sender, &state, &aid, &cfg, &last_pong).await;

    // Cleanup
    ping_handle.abort();
    state.agent_disconnected(&aid);
    tracing::info!("Agent {} disconnected", aid);
}

// ── Phase 1: Authentication ──────────────────────────────────────────

async fn authenticate_agent(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    state: &Arc<AppState>,
) -> Option<(String, AgentConfig)> {
    while let Some(msg) = receiver.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => return None,
            Err(_) => return None,
            _ => continue,
        };

        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                let _ = sender.send(Message::Text(
                    error_msg("invalid_message", "Could not parse message", None)
                )).await;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if msg_type != "auth" {
            let _ = sender.send(Message::Text(
                error_msg("not_authenticated", "Send auth message first", None)
            )).await;
            continue;
        }

        let token = parsed.get("token").and_then(|v| v.as_str()).unwrap_or("");
        let agent_id = parsed.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");

        let config = state.config.read().expect("config lock poisoned").clone();
        let agent_cfg = match authenticate(&config, token, agent_id) {
            None => {
                // #5: Log failed auth for attack detection
                state.audit.log(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    agent_id: agent_id.to_string(), action: "auth".to_string(),
                    target: None, ok: false, duration_ms: 0,
                    error: Some("auth_failed".to_string()),
                });
                let _ = sender.send(Message::Text(
                    error_msg("auth_failed", "Invalid token or agent_id", None)
                )).await;
                return None;
            }
            Some(cfg) => cfg,
        };

        // One connection per agent — prevents conflicting browser actions
        if state.is_agent_connected(agent_id) {
            let _ = sender.send(Message::Text(
                error_msg("duplicate_agent", "Agent ID already connected", None)
            )).await;
            return None;
        }

        state.agent_connected(agent_id);
        state.audit.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            agent_id: agent_id.to_string(), action: "auth".to_string(),
            target: None, ok: true, duration_ms: 0, error: None,
        });
        let _ = sender.send(Message::Text(
            result_msg("auth", None, None, None)
        )).await;
        return Some((agent_id.to_string(), agent_cfg));
    }

    None
}

// ── Heartbeat ────────────────────────────────────────────────────────
// Ping every 30s. If no pong in 90s, the connection is dead.
// Without this, zombie connections block reconnection (one-agent-per-ID rule).

fn spawn_heartbeat(
    sender: Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    last_pong: Arc<tokio::sync::Mutex<std::time::Instant>>,
    agent_id: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let elapsed = last_pong.lock().await.elapsed();
            if elapsed > std::time::Duration::from_secs(STALE_CONNECTION_SECS) {
                tracing::warn!("Agent {} heartbeat timeout, disconnecting", agent_id);
                let mut s = sender.lock().await;
                let _ = s.close().await;
                break;
            }
            let mut s = sender.lock().await;
            if s.send(Message::Text(ping_msg())).await.is_err() {
                break;
            }
        }
    })
}

// ── Phase 2: Action Loop ────────────────────────────────────────────

const VALID_ACTIONS: [&str; 11] = [
    "snapshot", "screenshot", "click", "type", "fill",
    "navigate", "press", "hover", "select", "evaluate", "close",
];

async fn run_action_loop(
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    sender: &Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    state: &Arc<AppState>,
    agent_id: &str,
    agent_cfg: &AgentConfig,
    last_pong: &Arc<tokio::sync::Mutex<std::time::Instant>>,
) {
    while let Some(msg) = receiver.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => continue,
        };

        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(
                    error_msg("invalid_message", "Could not parse message", None)
                )).await;
                continue;
            }
        };

        let action = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let req_id = parsed.get("request_id").cloned();

        if action == "pong" {
            *last_pong.lock().await = std::time::Instant::now();
            continue;
        }

        if !VALID_ACTIONS.contains(&action) {
            let mut s = sender.lock().await;
            let _ = s.send(Message::Text(
                error_msg("invalid_action", "Unknown action type", req_id)
            )).await;
            continue;
        }

        handle_action(sender, state, agent_id, agent_cfg, action, &parsed, req_id).await;
    }
}

// ── Action Pipeline ─────────────────────────────────────────────────
// Each action passes through: permission → rate limit → URL check → execute

async fn handle_action(
    sender: &Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    state: &Arc<AppState>,
    agent_id: &str,
    agent_cfg: &AgentConfig,
    action: &str,
    parsed: &serde_json::Value,
    req_id: Option<serde_json::Value>,
) {
    // Permission check
    if !has_permission(&agent_cfg.scopes, action) {
        let mut s = sender.lock().await;
        let _ = s.send(Message::Text(
            error_msg("permission_denied", &format!("Agent lacks required scope for '{}'", action), req_id)
        )).await;
        state.audit.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            agent_id: agent_id.to_string(), action: action.to_string(),
            target: None, ok: false, duration_ms: 0,
            error: Some("permission_denied".to_string()),
        });
        return;
    }

    // Rate limit
    if !state.check_rate_limit(agent_id, agent_cfg.rate_limit) {
        let mut s = sender.lock().await;
        let _ = s.send(Message::Text(
            error_msg("rate_limited", "Rate limit exceeded", req_id)
        )).await;
        state.audit.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            agent_id: agent_id.to_string(), action: action.to_string(),
            target: None, ok: false, duration_ms: 0,
            error: Some("rate_limited".to_string()),
        });
        return;
    }

    // URL restriction check
    let config = state.config.read().expect("config lock poisoned").clone();
    if let Some(block_reason) = check_url_restrictions(action, parsed, agent_cfg, &config).await {
        let target = parsed.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
        let mut s = sender.lock().await;
        let _ = s.send(Message::Text(
            error_msg("site_blocked", &block_reason, req_id)
        )).await;
        state.audit.log(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            agent_id: agent_id.to_string(), action: action.to_string(),
            target, ok: false, duration_ms: 0,
            error: Some("site_blocked".to_string()),
        });
        return;
    }

    // Execute via engine
    let start = std::time::Instant::now();
    let args = build_engine_args(action, parsed);
    let result = execute_engine(&config.engine.binary, &args, config.engine.timeout).await;
    let duration = start.elapsed().as_millis() as u64;

    let target = parsed.get("ref").and_then(|v| v.as_str())
        .or_else(|| parsed.get("url").and_then(|v| v.as_str()))
        .or_else(|| parsed.get("key").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    state.agent_action(agent_id, action);

    match result {
        Ok(data) => {
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: agent_id.to_string(), action: action.to_string(),
                target, ok: true, duration_ms: duration, error: None,
            });
            send_success(sender, action, data, req_id).await;
        }
        Err(e) => {
            state.audit.log(AuditEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                agent_id: agent_id.to_string(), action: action.to_string(),
                target, ok: false, duration_ms: duration,
                error: Some(e.clone()),
            });
            let mut s = sender.lock().await;
            let _ = s.send(Message::Text(
                error_msg("engine_error", &e, req_id)
            )).await;
        }
    }
}

// ── URL Restrictions ─────────────────────────────────────────────────
// Navigate checks the target URL. All other actions (except close)
// check the current page URL — prevents an agent from acting on
// a blocked site it navigated to before the blocklist was updated.

// #17: Dangerous URL schemes that should never be navigated to
const BLOCKED_SCHEMES: &[&str] = &["javascript:", "data:", "file:", "vbscript:"];

async fn check_url_restrictions(
    action: &str,
    parsed: &serde_json::Value,
    agent_cfg: &AgentConfig,
    config: &crate::config::Config,
) -> Option<String> {
    if action == "navigate" {
        let url = parsed.get("url").and_then(|v| v.as_str())?;
        // Block dangerous schemes before allowlist/blocklist
        let lower_url = url.to_lowercase();
        for scheme in BLOCKED_SCHEMES {
            if lower_url.starts_with(scheme) {
                return Some(format!("Blocked URL scheme: {}", scheme));
            }
        }
        let check = is_allowed(url, &agent_cfg.allowlist, &config.blocklist);
        if !check.allowed {
            return check.reason;
        }
    } else if action != "close" {
        // Check current page against blocklist
        let current_url = execute_engine(
            &config.engine.binary,
            &["get".to_string(), "url".to_string()],
            config.engine.timeout,
        ).await.ok()?;

        if !current_url.is_empty() {
            let check = is_allowed(&current_url, &agent_cfg.allowlist, &config.blocklist);
            if !check.allowed {
                return check.reason;
            }
        }
    }
    None
}

// ── Response Helpers ─────────────────────────────────────────────────

// #2: Validate screenshot paths stay within /tmp or cwd
fn is_valid_screenshot_path(file_path: &str) -> bool {
    let resolved = std::path::Path::new(file_path).canonicalize().unwrap_or_default();
    let resolved_str = resolved.to_string_lossy();
    let cwd = std::env::current_dir().unwrap_or_default();
    let cwd_str = cwd.to_string_lossy();
    resolved_str.starts_with("/tmp/") || resolved_str.starts_with(&*cwd_str)
}

async fn send_success(
    sender: &Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    action: &str,
    data: String,
    req_id: Option<serde_json::Value>,
) {
    // Screenshots: read the file from disk and tunnel as base64
    // so agents don't need filesystem access to the relay host
    if action == "screenshot" && !data.is_empty() {
        if let Some(path) = data.split_whitespace().find(|s| s.starts_with('/') && s.ends_with(".png")) {
            if !is_valid_screenshot_path(path) {
                eprintln!("Screenshot path rejected (outside allowed directories): {}", path);
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(
                    error_msg("screenshot_error", "Screenshot path outside allowed directory", req_id)
                )).await;
                return;
            }
            match tokio::fs::read(path).await {
                Ok(bytes) => {
                    use base64::Engine as _;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    let mut s = sender.lock().await;
                    let _ = s.send(Message::Text(
                        result_msg("screenshot", Some(b64), req_id, Some("image/png".to_string()))
                    )).await;
                    return;
                }
                Err(e) => {
                    eprintln!("Screenshot tunnel error: {} (path: {})", e, path);
                    // Fall through to raw engine output
                }
            }
        }
    }

    let resp_data = if data.is_empty() { None } else { Some(data) };
    let mut s = sender.lock().await;
    let _ = s.send(Message::Text(
        result_msg(action, resp_data, req_id, None)
    )).await;
}

// ── Engine Interface ─────────────────────────────────────────────────
// Shells out to the CDP binary (agent-browser by default).
// We don't link Rust to CDP directly — keeps the engine swappable.

fn build_engine_args(action: &str, msg: &serde_json::Value) -> Vec<String> {
    let str_field = |key: &str| msg.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string();

    match action {
        "snapshot"   => vec!["snapshot".into()],
        "screenshot" => vec!["screenshot".into()],
        "close"      => vec!["close".into()],
        "click"      => vec!["click".into(), str_field("ref")],
        "hover"      => vec!["hover".into(), str_field("ref")],
        "fill"       => vec!["fill".into(), str_field("ref"), str_field("text")],
        "type"       => vec!["type".into(), str_field("ref"), str_field("text")],
        "press"      => vec!["press".into(), str_field("key")],
        "navigate"   => vec!["open".into(), str_field("url")],
        "evaluate"   => vec!["eval".into(), str_field("js")],
        "select" => {
            let mut args = vec!["select".into(), str_field("ref")];
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

// ── Router ───────────────────────────────────────────────────────────

pub fn create_ws_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(ws_handler))
        .with_state(state)
}
