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

    // Empty allowlist = allow all (consistent with TS)
    if allowlist.is_empty() {
        return AllowCheckResult { allowed: true, reason: None };
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

    #[test]
    fn test_extract_hostname() {
        assert_eq!(extract_hostname("https://example.com/path"), Some("example.com".to_string()));
        assert_eq!(extract_hostname("http://USER@host.com:8080/path"), Some("host.com".to_string()));
        assert_eq!(extract_hostname("https://UPPER.COM"), Some("upper.com".to_string()));
        assert_eq!(extract_hostname("no-scheme"), None);
    }

    #[test]
    fn test_is_allowed_blocklist() {
        let result = is_allowed("https://evil.com", &[], &["evil.com".to_string()]);
        assert!(!result.allowed);
    }

    #[test]
    fn test_is_allowed_wildcard_blocklist() {
        let result = is_allowed("https://sub.evil.com", &[], &["*.evil.com".to_string()]);
        assert!(!result.allowed);
    }

    #[test]
    fn test_is_allowed_empty_allowlist_passes() {
        let result = is_allowed("https://anything.com", &[], &[]);
        assert!(result.allowed);
    }

    #[test]
    fn test_is_allowed_allowlist_match() {
        let result = is_allowed("https://good.com", &["good.com".to_string()], &[]);
        assert!(result.allowed);
    }

    #[test]
    fn test_is_allowed_allowlist_no_match() {
        let result = is_allowed("https://bad.com", &["good.com".to_string()], &[]);
        assert!(!result.allowed);
    }

    #[test]
    fn test_is_allowed_blocklist_takes_priority() {
        let result = is_allowed("https://evil.com", &["*".to_string()], &["evil.com".to_string()]);
        assert!(!result.allowed);
    }

    #[test]
    fn test_is_allowed_invalid_url() {
        let result = is_allowed("not-a-url", &[], &[]);
        assert!(!result.allowed);
    }
}
