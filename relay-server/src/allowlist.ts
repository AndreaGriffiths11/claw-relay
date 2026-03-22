export function matchesPattern(pattern: string, hostname: string): boolean {
  if (pattern === '*') return true;

  // String matching (consistent with Rust implementation)
  // Supports: exact match, *.example.com (subdomain wildcard)
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return hostname === pattern.slice(2) || hostname.endsWith(suffix);
  }

  return hostname === pattern;
}

export function isAllowed(url: string, allowlist: string[] | undefined, blocklist: string[] | undefined): { allowed: boolean; reason?: string } {
  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // Global blocklist always wins
  const effectiveBlocklist = blocklist || [];
  for (const pattern of effectiveBlocklist) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: false, reason: `${hostname} is blocked` };
    }
  }

  // Check agent allowlist (no allowlist = allow all)
  if (!allowlist || allowlist.length === 0) return { allowed: true };
  for (const pattern of allowlist) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `${hostname} is not in allowlist` };
}
