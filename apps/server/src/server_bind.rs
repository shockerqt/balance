use std::net::SocketAddr;

const SERVER_BIND_ADDR_ENV: &str = "SERVER_BIND_ADDR";
const DEFAULT_SERVER_BIND_ADDR: &str = "127.0.0.1:8080";
const SERVER_PORT: u16 = 8080;

fn parse_server_bind_addr(value: Option<&str>) -> anyhow::Result<SocketAddr> {
    let value = value.unwrap_or(DEFAULT_SERVER_BIND_ADDR);
    let bind_addr = value.parse::<SocketAddr>().map_err(|error| {
        anyhow::anyhow!(
            "{SERVER_BIND_ADDR_ENV} must be a valid socket address such as {DEFAULT_SERVER_BIND_ADDR}; got {value:?}: {error}"
        )
    })?;

    if bind_addr.port() != SERVER_PORT {
        anyhow::bail!(
            "{SERVER_BIND_ADDR_ENV} must use port {SERVER_PORT} to preserve the Balance API routes; got {value:?}"
        );
    }

    Ok(bind_addr)
}

pub fn server_bind_addr_from_env() -> anyhow::Result<SocketAddr> {
    match std::env::var(SERVER_BIND_ADDR_ENV) {
        Ok(value) => parse_server_bind_addr(Some(&value)),
        Err(std::env::VarError::NotPresent) => parse_server_bind_addr(None),
        Err(std::env::VarError::NotUnicode(_)) => anyhow::bail!(
            "{SERVER_BIND_ADDR_ENV} must be valid Unicode and a socket address such as {DEFAULT_SERVER_BIND_ADDR}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_SERVER_BIND_ADDR, SERVER_PORT, parse_server_bind_addr};
    use std::net::SocketAddr;

    #[test]
    fn server_bind_addr_defaults_to_loopback() {
        let bind_addr = parse_server_bind_addr(None).expect("default bind address should be valid");

        assert_eq!(bind_addr, "127.0.0.1:8080".parse::<SocketAddr>().unwrap());
        assert_eq!(DEFAULT_SERVER_BIND_ADDR, bind_addr.to_string());
    }

    #[test]
    fn server_bind_addr_accepts_an_explicit_override() {
        let bind_addr = parse_server_bind_addr(Some("0.0.0.0:8080"))
            .expect("explicit LAN bind address should be valid");

        assert_eq!(bind_addr, "0.0.0.0:8080".parse::<SocketAddr>().unwrap());
    }

    #[test]
    fn server_bind_addr_rejects_invalid_values() {
        let error = parse_server_bind_addr(Some("not-a-socket-address"))
            .expect_err("invalid bind address should fail");

        assert!(error.to_string().contains("SERVER_BIND_ADDR"));
        assert!(error.to_string().contains("127.0.0.1:8080"));
    }

    #[test]
    fn server_bind_addr_rejects_a_port_change() {
        let error = parse_server_bind_addr(Some("0.0.0.0:3000"))
            .expect_err("server port changes should be rejected");

        assert!(error.to_string().contains("SERVER_BIND_ADDR"));
        assert!(error.to_string().contains(&SERVER_PORT.to_string()));
    }
}
