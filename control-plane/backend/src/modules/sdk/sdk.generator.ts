interface EndpointInfo {
  method: string;
  path: string;
  description: string | null;
  auth_type: string;
  source_type: string;
  source_config: Record<string, unknown>;
}

export function generateTypeScript(
  projectSlug: string,
  workerUrl: string,
  endpoints: EndpointInfo[]
): string {
  const lines: string[] = [];

  lines.push(`// DataForge SDK for project "${projectSlug}"`);
  lines.push(`// Auto-generated — do not edit manually`);
  lines.push('');
  lines.push(`const BASE_URL = '${workerUrl}/api/v1/${projectSlug}';`);
  lines.push('');
  lines.push('interface RequestOptions {');
  lines.push('  apiKey?: string;');
  lines.push('  headers?: Record<string, string>;');
  lines.push('}');
  lines.push('');
  lines.push('async function request<T>(');
  lines.push('  method: string,');
  lines.push('  path: string,');
  lines.push('  options: RequestOptions = {},');
  lines.push('  body?: unknown');
  lines.push('): Promise<T> {');
  lines.push('  const headers: Record<string, string> = {');
  lines.push("    'Content-Type': 'application/json',");
  lines.push('    ...options.headers,');
  lines.push('  };');
  lines.push("  if (options.apiKey) headers['X-API-Key'] = options.apiKey;");
  lines.push('');
  lines.push('  const res = await fetch(`${BASE_URL}${path}`, {');
  lines.push('    method,');
  lines.push('    headers,');
  lines.push("    body: body ? JSON.stringify(body) : undefined,");
  lines.push('  });');
  lines.push('');
  lines.push('  if (!res.ok) {');
  lines.push('    const err = await res.json().catch(() => ({}));');
  lines.push("    throw new Error(err.error || `Request failed: ${res.status}`);");
  lines.push('  }');
  lines.push('');
  lines.push('  return res.json();');
  lines.push('}');
  lines.push('');
  lines.push(`export class DataForgeClient {`);
  lines.push('  private apiKey: string;');
  lines.push('');
  lines.push('  constructor(apiKey: string) {');
  lines.push('    this.apiKey = apiKey;');
  lines.push('  }');
  lines.push('');

  for (const ep of endpoints) {
    const fnName = endpointToFunctionName(ep.method, ep.path);
    const desc = ep.description ? `  /** ${ep.description} */` : '';
    if (desc) lines.push(desc);

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(ep.method);
    const hasId = ep.path.includes(':id');

    const params: string[] = [];
    if (hasId) params.push('id: string');
    if (hasBody) params.push('data: Record<string, unknown>');

    const pathExpr = ep.path.replace(':id', '${id}');

    lines.push(`  async ${fnName}(${params.join(', ')}) {`);
    lines.push(`    return request('${ep.method}', \`${pathExpr}\`, { apiKey: this.apiKey }${hasBody ? ', data' : ''});`);
    lines.push('  }');
    lines.push('');
  }

  lines.push('}');

  return lines.join('\n');
}

export function generatePython(
  projectSlug: string,
  workerUrl: string,
  endpoints: EndpointInfo[]
): string {
  const lines: string[] = [];

  lines.push(`# DataForge SDK for project "${projectSlug}"`);
  lines.push('# Auto-generated — do not edit manually');
  lines.push('');
  lines.push('import requests');
  lines.push('');
  lines.push('');
  lines.push('class DataForgeClient:');
  lines.push(`    BASE_URL = "${workerUrl}/api/v1/${projectSlug}"`);
  lines.push('');
  lines.push('    def __init__(self, api_key: str):');
  lines.push('        self.api_key = api_key');
  lines.push('        self.session = requests.Session()');
  lines.push('        self.session.headers.update({');
  lines.push("            'Content-Type': 'application/json',");
  lines.push("            'X-API-Key': api_key,");
  lines.push('        })');
  lines.push('');
  lines.push('    def _request(self, method: str, path: str, json=None):');
  lines.push('        url = f"{self.BASE_URL}{path}"');
  lines.push('        response = self.session.request(method, url, json=json)');
  lines.push('        response.raise_for_status()');
  lines.push('        return response.json()');
  lines.push('');

  for (const ep of endpoints) {
    const fnName = endpointToPythonName(ep.method, ep.path);
    const desc = ep.description ? `        """${ep.description}"""` : '';
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(ep.method);
    const hasId = ep.path.includes(':id');

    const params: string[] = ['self'];
    if (hasId) params.push('id: str');
    if (hasBody) params.push('data: dict');

    const pathExpr = ep.path.replace(':id', '{id}');

    lines.push(`    def ${fnName}(${params.join(', ')}):`);
    if (desc) lines.push(desc);
    lines.push(`        return self._request("${ep.method}", f"${pathExpr}"${hasBody ? ', json=data' : ''})`);
    lines.push('');
  }

  return lines.join('\n');
}

export function generateCurl(
  projectSlug: string,
  workerUrl: string,
  endpoints: EndpointInfo[]
): string {
  const lines: string[] = [];
  const base = `${workerUrl}/api/v1/${projectSlug}`;

  lines.push(`# DataForge cURL examples for project "${projectSlug}"`);
  lines.push('# Replace YOUR_API_KEY with your actual API key');
  lines.push('');

  for (const ep of endpoints) {
    const desc = ep.description ?? `${ep.method} ${ep.path}`;
    lines.push(`# ${desc}`);

    const url = `${base}${ep.path.replace(':id', 'RECORD_ID')}`;
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(ep.method);

    let cmd = `curl -X ${ep.method} "${url}"`;
    cmd += ` \\\n  -H "Content-Type: application/json"`;

    if (ep.auth_type === 'api_token') {
      cmd += ` \\\n  -H "X-API-Key: YOUR_API_KEY"`;
    }

    if (hasBody) {
      cmd += ` \\\n  -d '{"key": "value"}'`;
    }

    lines.push(cmd);
    lines.push('');
  }

  return lines.join('\n');
}

function endpointToFunctionName(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter((p) => p && !p.startsWith(':'))
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)));

  const prefix = method === 'GET' ? 'get' : method === 'POST' ? 'create' : method === 'PUT' ? 'update' : method === 'PATCH' ? 'patch' : 'delete';
  return prefix + parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function endpointToPythonName(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter((p) => p && !p.startsWith(':'));

  const prefix = method === 'GET' ? 'get' : method === 'POST' ? 'create' : method === 'PUT' ? 'update' : method === 'PATCH' ? 'patch' : 'delete';
  return prefix + '_' + parts.join('_');
}
