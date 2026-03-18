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
                .add_directive("claw_relay_core=info".parse().unwrap()),
        )
        .init();

    let config_path = std::env::args().nth(1).unwrap_or_else(|| {
        // Look for config.yaml in parent directory (relay-server/)
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

    tracing::info!("Starting Claw Relay (Rust)");
    tracing::info!("WebSocket server on {}:{}", ws_host, ws_port);

    let ws_state = Arc::clone(&state);
    let dash_state = Arc::clone(&state);

    let ws_handle = tokio::spawn(async move {
        let router = relay::create_ws_router(ws_state);
        let listener = tokio::net::TcpListener::bind(format!("{}:{}", ws_host, ws_port))
            .await
            .expect("Failed to bind WebSocket port");
        tracing::info!("Claw Relay server listening on {}:{}", ws_host, ws_port);
        axum::serve(listener, router).await.expect("WebSocket server error");
    });

    let dash_handle = tokio::spawn(async move {
        dashboard::start_dashboard(dash_state).await;
    });

    tokio::select! {
        _ = ws_handle => {},
        _ = dash_handle => {},
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Shutting down gracefully...");
        }
    }
}
