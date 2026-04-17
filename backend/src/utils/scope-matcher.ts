/**
 * Scope model: `<verb>:<resource>` where:
 *   verb ∈ { read, write, delete, admin }
 *   resource = table name or "*"
 *
 * Legacy shortcuts (without colon): `read`, `write`, `delete`, `admin`
 *   interpreted as `{verb}:*` (any table).
 *
 * Matching rules for whether token grants required scope:
 *   - exact match wins
 *   - admin covers read/write/delete (same resource)
 *   - resource "*" covers any resource for the same verb
 *   - `admin:*` or legacy `admin` is a full grant
 */

const VERBS = new Set(['read', 'write', 'delete', 'admin']);

interface ParsedScope {
  verb: string;
  resource: string;
}

function parseScope(raw: string): ParsedScope | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (VERBS.has(s)) return { verb: s, resource: '*' };
  const idx = s.indexOf(':');
  if (idx < 0) return null;
  const verb = s.slice(0, idx);
  const resource = s.slice(idx + 1);
  if (!VERBS.has(verb) || !resource) return null;
  return { verb, resource };
}

function grantsSingle(granted: ParsedScope, required: ParsedScope): boolean {
  // admin covers read/write/delete on the same (or wildcard) resource
  const verbOk = granted.verb === required.verb || granted.verb === 'admin';
  if (!verbOk) return false;
  if (granted.resource === '*') return true;
  if (granted.resource === required.resource) return true;
  return false;
}

/** Returns true if the token's scopes cover every scope required by an endpoint. */
export function hasRequiredScopes(tokenScopes: unknown, requiredScopes: unknown): boolean {
  const req = Array.isArray(requiredScopes) ? requiredScopes : [];
  if (req.length === 0) return true;

  const tokenRaw = Array.isArray(tokenScopes) ? tokenScopes : [];
  const granted = tokenRaw.map(parseScope).filter((x): x is ParsedScope => x !== null);
  if (granted.length === 0) return false;

  for (const r of req) {
    const parsed = parseScope(String(r));
    if (!parsed) continue;
    if (!granted.some(g => grantsSingle(g, parsed))) return false;
  }
  return true;
}

/** Derives default required_scopes from an endpoint's source_config + method. */
export function deriveRequiredScopes(sourceType: string, sourceConfig: Record<string, unknown>, method: string): string[] {
  if (sourceType === 'table') {
    const table = String(sourceConfig.table ?? '').toLowerCase();
    if (!table) return [];
    const op = String(sourceConfig.operation ?? 'find').toLowerCase();
    if (op === 'find' || op === 'findone' || op === 'list' || op === 'get' || op === 'read') return [`read:${table}`];
    if (op === 'delete') return [`delete:${table}`];
    if (op === 'create' || op === 'create_many' || op === 'update') return [`write:${table}`];
    return [`admin:${table}`];
  }
  if (sourceType === 'custom_sql') {
    // Safe default: GET → read:*, other methods → admin:*.
    return method === 'GET' ? ['read:*'] : ['admin:*'];
  }
  return [];
}

/** Normalize + dedupe scopes (lowercase, trim, drop invalid). */
export function normalizeScopes(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out = new Set<string>();
  for (const s of arr) {
    const parsed = parseScope(String(s));
    if (parsed) out.add(`${parsed.verb}:${parsed.resource}`);
  }
  return [...out];
}
