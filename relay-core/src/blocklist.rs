pub fn matches_pattern(pattern: &str, hostname: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(domain) = pattern.strip_prefix("*.") {
        hostname.ends_with(domain) && (hostname == domain || hostname.ends_with(&format!(".{}", domain)))
    } else {
        pattern == hostname
    }
}

pub struct AllowCheckResult {
    pub allowed: bool,
    pub reason: Option<String>,
}

pub fn is_allowed(url: &str, allowlist: &[String], blocklist: &[String]) -> AllowCheckResult {
    let hostname = match extract_hostname(url) {
        Some(h) => h,
        None => return AllowCheckResult { allowed: false, reason: Some("Invalid URL".to_string()) },
    };

    for pattern in blocklist {
        if matches_pattern(pattern, &hostname) {
            return AllowCheckResult { allowed: false, reason: Some(format!("{} is blocked", hostname)) };
        }
    }

    for pattern in allowlist {
        if matches_pattern(pattern, &hostname) {
            return AllowCheckResult { allowed: true, reason: None };
        }
    }

    AllowCheckResult { allowed: false, reason: Some(format!("{} is not in allowlist", hostname)) }
}

fn extract_hostname(url: &str) -> Option<String> {
    let after_scheme = url.find("://").map(|pos| &url[pos + 3..])?;
    let host_part = after_scheme.split('/').next()?;
    let host = host_part.split(':').next()?;
    let host = host.split('@').last()?;
    Some(host.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_pattern() {
        assert!(matches_pattern("*", "example.com"));
        assert!(matches_pattern("*.example.com", "sub.example.com"));
        assert!(matches_pattern("*.example.com", "example.com"));
        assert!(!matches_pattern("*.example.com", "other.com"));
        assert!(!matches_pattern("*.example.com", "notexample.com"));
        assert!(matches_pattern("example.com", "example.com"));
        assert!(!matches_pattern("example.com", "other.com"));
    }
}
