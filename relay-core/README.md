# relay-core — Rust Implementation

Native Rust relay server. Same config, same protocol, same dashboard — single binary, no runtime dependencies.

## Build

```bash
cd relay-core
cargo build --release
```

## Run

```bash
./target/release/claw-relay-core ../relay-server/config.yaml
```

## Dependencies

tokio, axum, serde, serde_json, serde_yaml, tower-http, sha2, chrono, tracing

See [docs/](../docs/) for protocol, setup, and dashboard documentation.
