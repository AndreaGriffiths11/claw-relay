pub fn matches_pattern(pattern: &str, hostname: &str) -> bool {
    if pattern == "*" { return true; }
    let regex_str = format!("^{}$",
        pattern.replace('.', r"\.").replace('*', ".*"));
    regex_str.parse::<regex_lite::Regex>()
        .map(|re| re.is_match(hostname))
        .unwrap_or(false)
}

/// We avoid pulling in the regex crate — use a simple inline matcher instead
mod regex_lite {
    pub struct Regex(String);
    
    impl std::str::FromStr for Regex {
        type Err = ();
        fn from_str(s: &str) -> Result<Self, ()> { Ok(Regex(s.to_string())) }
    }
    
    impl Regex {
        pub fn is_match(&self, text: &str) -> bool {
            // Simple glob-to-match: the pattern is ^...$  with \. for literal dots and .* for wildcards
            // Convert back to a simple glob matcher
            let pattern = self.0.trim_start_matches('^').trim_end_matches('$');
            glob_match(pattern, text)
        }
    }
    
    fn glob_match(pattern: &str, text: &str) -> bool {
        let p: Vec<char> = pattern.chars().collect();
        let t: Vec<char> = text.chars().collect();
        glob_match_inner(&p, &t)
    }
    
    fn glob_match_inner(p: &[char], t: &[char]) -> bool {
        if p.is_empty() { return t.is_empty(); }
        // Handle \. (escaped dot — literal dot)
        if p.len() >= 2 && p[0] == '\\' && p[1] == '.' {
            if t.is_empty() || t[0] != '.' { return false; }
            return glob_match_inner(&p[2..], &t[1..]);
        }
        // Handle .* (wildcard)
        if p.len() >= 2 && p[0] == '.' && p[1] == '*' {
            // Try matching 0 or more chars
            for i in 0..=t.len() {
                if glob_match_inner(&p[2..], &t[i..]) { return true; }
            }
            return false;
        }
        // Literal match
        if t.is_empty() { return false; }
        if p[0] == t[0] {
            return glob_match_inner(&p[1..], &t[1..]);
        }
        false
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
    // Simple URL hostname extraction
    let after_scheme = if let Some(pos) = url.find("://") {
        &url[pos + 3..]
    } else {
        return None;
    };
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
        assert!(!matches_pattern("*.example.com", "other.com"));
        assert!(matches_pattern("example.com", "example.com"));
    }
}
