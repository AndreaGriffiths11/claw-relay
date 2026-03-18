
const SCOPE_MAP: &[(&str, &str)] = &[
    ("snapshot", "read"),
    ("screenshot", "read"),
    ("click", "interact"),
    ("type", "interact"),
    ("fill", "interact"),
    ("press", "interact"),
    ("hover", "interact"),
    ("select", "interact"),
    ("navigate", "navigate"),
    ("close", "navigate"),
    ("evaluate", "execute"),
];

pub fn get_required_scope(action: &str) -> Option<&'static str> {
    SCOPE_MAP.iter().find(|(a, _)| *a == action).map(|(_, s)| *s)
}

pub fn has_permission(scopes: &[String], action: &str) -> bool {
    match get_required_scope(action) {
        Some(required) => scopes.iter().any(|s| s == required),
        None => false,
    }
}

pub const VALID_SCOPES: &[&str] = &["read", "interact", "navigate", "execute"];
