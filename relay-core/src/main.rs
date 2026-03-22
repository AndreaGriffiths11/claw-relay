mod config;
mod auth;
mod permissions;
mod blocklist;
mod audit;
mod state;
mod dashboard;
mod relay;

use std::sync::Arc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("claw_relay_core=info".parse().expect("static log directive must be valid")),
        )
        .init();

    let config_path = std::env::args().nth(1).unwrap_or_else(|| {
        let default = "../relay-server/config.yaml";
        if std::path::Path::new(default).exists() {
            default.to_string()
        } else {
            eprintln!("Usage: claw-relay-core <config.yaml>");
            std::process::exit(1);
        }
    });

    let config = config::load_config(&config_path).unwrap_or_else(|e| {
        eprintln!("Failed to load config from {}: {}", config_path, e);
        std::process::exit(1);
    });

    let ws_port = config.server.port;
    let ws_host = config.server.host.clone();

    let state = state::AppState::new(config, config_path);
    state::AppState::start_cleanup_task(state.clone());

    tracing::info!("Starting Claw Relay (Rust)");
    tracing::info!("WebSocket server on {}:{}", ws_host, ws_port);

    let ws_state = Arc::clone(&state);
    let dash_state = Arc::clone(&state);

    let ws_router = relay::create_ws_router(ws_state);
    let ws_listener = tokio::net::TcpListener::bind(format!("{}:{}", ws_host, ws_port))
        .await
        .expect("Failed to bind WebSocket port");
    tracing::info!("Claw Relay server listening on {}:{}", ws_host, ws_port);

    let dash_port = state.config.read().expect("config lock poisoned").dashboard.port;
    let dash_router = dashboard::create_router(dash_state);
    let dash_listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", dash_port))
        .await
        .expect("Failed to bind dashboard port");
    tracing::info!("Dashboard running on http://localhost:{}", dash_port);

    // Graceful shutdown signal
    let shutdown = async {
        let ctrl_c = tokio::signal::ctrl_c();
        #[cfg(unix)]
        {
            let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("failed to register SIGTERM handler");
            tokio::select! {
                _ = ctrl_c => {},
                _ = sigterm.recv() => {},
            }
        }
        #[cfg(not(unix))]
        {
            ctrl_c.await.ok();
        }
        tracing::info!("Shutdown signal received, closing connections...");
    };

    let shutdown_state = Arc::clone(&state);

    tokio::select! {
        res = axum::serve(ws_listener, ws_router).with_graceful_shutdown(shutdown) => {
            if let Err(e) = res { tracing::error!("WebSocket server error: {}", e); }
        }
        res = axum::serve(dash_listener, dash_router) => {
            if let Err(e) = res { tracing::error!("Dashboard server error: {}", e); }
        }
    }

    // On shutdown, log connected agents and clean up
    let conns = shutdown_state.connections.read().expect("connections lock poisoned");
    if !conns.is_empty() {
        let agent_ids: Vec<&str> = conns.keys().map(|s| s.as_str()).collect();
        tracing::info!("Closing connections for agents: {:?}", agent_ids);
    }
    drop(conns);
    tracing::info!("Claw Relay shut down cleanly");
}
