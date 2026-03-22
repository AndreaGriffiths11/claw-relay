use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{Json, Response},
    routing::{get, put},
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::auth::check_admin_auth;
use crate::config::{redact_token, write_config_atomic, AgentConfig};
use crate::permissions::VALID_SCOPES;
use crate::state::AppState;


fn get_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get("authorization") {
        if let Ok(val) = auth.to_str() {
            if let Some(token) = val.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn check_auth(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let config = state.config.read().unwrap();
    if config.dashboard.admin_token.is_empty() {
        return Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Dashboard disabled: no adminToken configured"}))));
    }
    match get_token(headers) {
        None => Err((StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Unauthorized"})))),
        Some(t) => {
            if check_admin_auth(&config.dashboard.admin_token, &t) {
                Ok(())
            } else {
                Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Forbidden"}))))
            }
        }
    }
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn status_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    let conns = state.connections.read().unwrap();
    let config = state.config.read().unwrap();
    
    let mut agents_status: HashMap<String, serde_json::Value> = HashMap::new();
    for (id, agent_cfg) in &config.agents {
        let connected = conns.contains_key(id);
        let conn_info = conns.get(id);
        agents_status.insert(id.clone(), serde_json::json!({
            "connected": connected,
            "scopes": agent_cfg.scopes,
            "connectedAt": conn_info.map(|c| c.connected_at.clone()),
            "lastAction": conn_info.and_then(|c| c.last_action.clone()),
            "lastActionAt": conn_info.and_then(|c| c.last_action_at.clone()),
            "actionCount": conn_info.map(|c| c.action_count).unwrap_or(0),
        }));
    }
    
    Ok(Json(serde_json::json!({
        "connections": conns.values().collect::<Vec<_>>(),
        "startedAt": state.started_at,
        "agents": agents_status,
    })))
}

async fn get_agents_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    let config = state.config.read().unwrap();
    let mut agents: HashMap<String, serde_json::Value> = HashMap::new();
    for (id, agent) in &config.agents {
        agents.insert(id.clone(), serde_json::json!({
            "token": redact_token(&agent.token),
            "scopes": agent.scopes,
            "allowlist": agent.allowlist,
            "rateLimit": agent.rate_limit,
        }));
    }
    Ok(Json(serde_json::json!(agents)))
}

#[derive(Deserialize)]
struct CreateAgentBody {
    id: String,
    token: String,
    scopes: Option<Vec<String>>,
    allowlist: Option<Vec<String>>,
    #[serde(rename = "rateLimit")]
    rate_limit: Option<u32>,
}

fn validate_agent_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

async fn create_agent_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateAgentBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    
    if !validate_agent_id(&body.id) {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "id must be alphanumeric/hyphens/underscores, 1-64 chars"}))));
    }
    if body.token.len() < 8 {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "token must be a string of at least 8 characters"}))));
    }
    if let Some(ref scopes) = body.scopes {
        if !scopes.iter().all(|s| VALID_SCOPES.contains(&s.as_str())) {
            return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("scopes must be an array of: {}", VALID_SCOPES.join(", "))}))));
        }
    }

    let mut config = state.config.write().unwrap();
    if config.agents.contains_key(&body.id) {
        return Err((StatusCode::CONFLICT, Json(serde_json::json!({"error": "Agent already exists"}))));
    }
    
    config.agents.insert(body.id.clone(), AgentConfig {
        token: body.token,
        scopes: body.scopes.unwrap_or_else(|| vec!["read".to_string()]),
        allowlist: body.allowlist.unwrap_or_else(|| vec!["*".to_string()]),
        rate_limit: body.rate_limit.unwrap_or(30),
    });
    
    let _ = write_config_atomic(&state.config_path, &config);
    Ok((StatusCode::CREATED, Json(serde_json::json!({"ok": true}))))
}

#[derive(Deserialize)]
struct UpdateAgentBody {
    token: Option<String>,
    scopes: Option<Vec<String>>,
    allowlist: Option<Vec<String>>,
    #[serde(rename = "rateLimit")]
    rate_limit: Option<u32>,
}

async fn update_agent_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateAgentBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    
    let mut config = state.config.write().unwrap();
    let agent = config.agents.get_mut(&id)
        .ok_or((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Agent not found"}))))?;
    
    if let Some(token) = body.token {
        if token.len() < 8 {
            return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "token must be a string of at least 8 characters"}))));
        }
        agent.token = token;
    }
    if let Some(scopes) = body.scopes {
        if !scopes.iter().all(|s| VALID_SCOPES.contains(&s.as_str())) {
            return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("scopes must be an array of: {}", VALID_SCOPES.join(", "))}))));
        }
        agent.scopes = scopes;
    }
    if let Some(allowlist) = body.allowlist { agent.allowlist = allowlist; }
    if let Some(rate_limit) = body.rate_limit { agent.rate_limit = rate_limit; }
    
    let _ = write_config_atomic(&state.config_path, &config);
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn delete_agent_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    
    let mut config = state.config.write().unwrap();
    if config.agents.remove(&id).is_none() {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Agent not found"}))));
    }
    let _ = write_config_atomic(&state.config_path, &config);
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn get_audit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    let entries = state.audit.read_from_file();
    Ok(Json(serde_json::json!({"entries": entries})))
}

async fn clear_audit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    state.audit.clear();
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn download_audit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    let entries = state.audit.read_from_file();
    let json = serde_json::to_string_pretty(&entries).unwrap_or_default();
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    Ok(Response::builder()
        .header("Content-Type", "application/json")
        .header("Content-Disposition", format!("attachment; filename=\"claw-relay-audit-{}.json\"", date))
        .body(axum::body::Body::from(json))
        .unwrap())
}

async fn get_config_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_auth(&state, &headers)?;
    let config = state.config.read().unwrap();
    let mut redacted: HashMap<String, serde_json::Value> = HashMap::new();
    for (id, agent) in &config.agents {
        redacted.insert(id.clone(), serde_json::json!({
            "token": redact_token(&agent.token),
            "scopes": agent.scopes,
            "allowlist": agent.allowlist,
            "rateLimit": agent.rate_limit,
        }));
    }
    Ok(Json(serde_json::json!({
        "agents": redacted,
        "server": config.server,
        "dashboard": {"port": config.dashboard.port},
    })))
}

pub fn create_router(state: Arc<AppState>) -> Router {
    // Look for dashboard dist relative to config file's directory,
    // then try common locations
    let config_dir = std::path::PathBuf::from(&state.config_path)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();
    let dashboard_dist = if config_dir.join("dashboard/dist").exists() {
        config_dir.join("dashboard/dist")
    } else if config_dir.join("../relay-server/dashboard/dist").exists() {
        config_dir.join("../relay-server/dashboard/dist")
    } else {
        config_dir.join("dashboard/dist")
    };

    let api = Router::new()
        .route("/health", get(health_handler))
        .route("/api/status", get(status_handler))
        .route("/api/agents", get(get_agents_handler).post(create_agent_handler))
        .route("/api/agents/{id}", put(update_agent_handler).delete(delete_agent_handler))
        .route("/api/audit", get(get_audit_handler).delete(clear_audit_handler))
        .route("/api/audit/download", get(download_audit_handler))
        .route("/api/config", get(get_config_handler))
        .with_state(state);

    if dashboard_dist.exists() {
        api.fallback_service(ServeDir::new(&dashboard_dist).fallback(tower_http::services::ServeFile::new(
            dashboard_dist.join("index.html"),
        )))
    } else {
        api
    }
}

pub async fn start_dashboard(state: Arc<AppState>) {
    let port = state.config.read().unwrap().dashboard.port;
    let router = create_router(state);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .expect("Failed to bind dashboard port");
    tracing::info!("Dashboard running on http://localhost:{}", port);
    axum::serve(listener, router).await.expect("Dashboard server error");
}
