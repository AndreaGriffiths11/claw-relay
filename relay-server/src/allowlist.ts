// URL allowlist/blocklist enforcement.
// Blocklist always wins over allowlist — even if an agent's allowlist
// includes a domain, a global blocklist entry blocks it.
// Empty allowlist means "allow everything not blocked."

export function matchesPattern(pattern: string, hostname: string): boolean {
  if (pattern === '*') return true;

  // Wildcard subdomain: *.example.com matches example.com AND sub.example.com
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
  }

  return hostname === pattern;
}

export function isAllowed(
  url: string,
  allowlist: readonly string[] | undefined,
  blocklist: readonly string[] | undefined,
): { allowed: boolean; reason?: string } {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // Blocklist check runs first — blocked domains can never be overridden
  for (const pattern of blocklist || []) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: false, reason: `${hostname} is blocked` };
    }
  }

  // No allowlist configured = allow everything not blocked
  if (!allowlist || allowlist.length === 0) return { allowed: true };

  for (const pattern of allowlist) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `${hostname} is not in allowlist` };
}
