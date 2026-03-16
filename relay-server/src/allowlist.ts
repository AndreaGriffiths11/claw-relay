export function matchesPattern(pattern: string, hostname: string): boolean {
  if (pattern === '*') return true;
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return regex.test(hostname);
}

export function isAllowed(url: string, allowlist: string[], blocklist: string[]): { allowed: boolean; reason?: string } {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // Global blocklist always wins
  for (const pattern of blocklist) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: false, reason: `${hostname} is blocked` };
    }
  }

  // Check agent allowlist
  for (const pattern of allowlist) {
    if (matchesPattern(pattern, hostname)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `${hostname} is not in allowlist` };
}
