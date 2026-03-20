// FAS API Whitelist — External API call authorization
// Only domains and paths explicitly listed here can be called.
// Each entry specifies allowed path patterns (regex), whether approval is required,
// and the risk level of the API.
//
// This is a security layer to prevent unauthorized outbound requests,
// especially from automated agents that might be compromised.

// === Types ===

export type WhitelistEntry = {
  domain: string;
  allowed_paths: string[];    // regex patterns matched against URL pathname
  requires_approval: boolean;
  risk_level: 'low' | 'mid' | 'high';
};

export type ApiWhitelistConfig = {
  entries: WhitelistEntry[];
  log_all_requests: boolean;  // default: true
};

export type IsAllowedResult = {
  allowed: boolean;
  reason: string;
};

export type CheckRequestResult = {
  allowed: boolean;
  requires_approval: boolean;
  risk_level: string;
  reason: string;
};

// === Default whitelist ===

export const DEFAULT_WHITELIST: WhitelistEntry[] = [
  { domain: 'api.telegram.org', allowed_paths: ['/bot.*'], requires_approval: false, risk_level: 'low' },
  { domain: 'hooks.slack.com', allowed_paths: ['/services/.*'], requires_approval: false, risk_level: 'low' },
  { domain: 'api.notion.com', allowed_paths: ['/v1/.*'], requires_approval: false, risk_level: 'low' },
  { domain: 'k-startup.go.kr', allowed_paths: ['/.*'], requires_approval: false, risk_level: 'low' },
  { domain: 'applyhome.co.kr', allowed_paths: ['/.*'], requires_approval: false, risk_level: 'low' },
  { domain: 'api.clay.com', allowed_paths: ['/.*'], requires_approval: true, risk_level: 'mid' },
];

// === Default config ===

const DEFAULT_CONFIG: ApiWhitelistConfig = {
  entries: [...DEFAULT_WHITELIST],
  log_all_requests: true,
};

// === Helpers ===

// Parse a URL and extract hostname (with port if present) and pathname.
// Returns null for malformed URLs.
const parse_url_parts = (url: string): { host: string; pathname: string } | null => {
  try {
    const parsed = new URL(url);
    // Include port in host if non-standard
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    return { host, pathname: parsed.pathname };
  } catch {
    return null;
  }
};

// Check if a pathname matches any of the allowed path patterns
const matches_path = (pathname: string, allowed_paths: string[]): boolean => {
  return allowed_paths.some((pattern) => {
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(pathname);
  });
};

// === Factory function ===

export const create_api_whitelist = (config?: Partial<ApiWhitelistConfig>) => {
  const cfg: ApiWhitelistConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    entries: config?.entries ? [...config.entries] : [...DEFAULT_CONFIG.entries],
  };

  // Internal mutable list
  const entries: WhitelistEntry[] = cfg.entries;

  // --- is_allowed: Check if a URL is permitted ---
  const is_allowed = (url: string): IsAllowedResult => {
    const parts = parse_url_parts(url);
    if (!parts) {
      return { allowed: false, reason: 'invalid URL' };
    }

    // Find matching domain entry
    const entry = entries.find((e) => e.domain === parts.host);
    if (!entry) {
      return { allowed: false, reason: `domain '${parts.host}' not in whitelist` };
    }

    // Check if path matches
    if (!matches_path(parts.pathname, entry.allowed_paths)) {
      return { allowed: false, reason: `path '${parts.pathname}' not allowed for domain '${parts.host}'` };
    }

    return { allowed: true, reason: 'whitelisted' };
  };

  // --- check_request: Full request check with approval/risk info ---
  const check_request = (url: string, _method: string): CheckRequestResult => {
    const parts = parse_url_parts(url);
    if (!parts) {
      return { allowed: false, requires_approval: false, risk_level: 'high', reason: 'invalid URL' };
    }

    const entry = entries.find((e) => e.domain === parts.host);
    if (!entry) {
      return {
        allowed: false,
        requires_approval: false,
        risk_level: 'high',
        reason: `domain '${parts.host}' not in whitelist`,
      };
    }

    if (!matches_path(parts.pathname, entry.allowed_paths)) {
      return {
        allowed: false,
        requires_approval: false,
        risk_level: entry.risk_level,
        reason: `path '${parts.pathname}' not allowed for domain '${parts.host}'`,
      };
    }

    return {
      allowed: true,
      requires_approval: entry.requires_approval,
      risk_level: entry.risk_level,
      reason: 'whitelisted',
    };
  };

  // --- add_entry: Add or update a whitelist entry ---
  // If an entry with the same domain already exists, it is replaced.
  const add_entry = (entry: WhitelistEntry): void => {
    const idx = entries.findIndex((e) => e.domain === entry.domain);
    if (idx >= 0) {
      entries[idx] = { ...entry };
    } else {
      entries.push({ ...entry });
    }
  };

  // --- get_whitelist: Return a copy of all whitelist entries ---
  const get_whitelist = (): WhitelistEntry[] => {
    return entries.map((e) => ({ ...e, allowed_paths: [...e.allowed_paths] }));
  };

  return {
    is_allowed,
    check_request,
    add_entry,
    get_whitelist,
  };
};

// === Export type for external use ===

export type ApiWhitelist = ReturnType<typeof create_api_whitelist>;
