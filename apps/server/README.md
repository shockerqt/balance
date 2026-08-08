# Balance server

The server listens on `127.0.0.1:8080` by default. This keeps the production
API private to the host, where Nginx exposes the existing HTTPS API and MCP
routes. The port and HTTP/WebSocket/MCP routes remain unchanged.

## Server bind address

Set `SERVER_BIND_ADDR` to a complete numeric socket address when a different
bind is required. It must keep port `8080`, so the existing API, WebSocket and
MCP routes stay on their documented port. The process fails at startup with a
clear error if its value is not a valid socket address or changes the port.

```bash
# Default; no variable is required.
cargo run -p server

# Explicit development-only LAN override. Do not use this for production.
SERVER_BIND_ADDR=0.0.0.0:8080 cargo run -p server
```

Production deployments must retain the loopback default unless the INF-002
network exposure review, health checks, rollback procedure and approval permit
a different bind. Do not add the override to a committed environment file.
