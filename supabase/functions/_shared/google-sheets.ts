// Minimal Google Sheets API v4 reader for Deno Edge Functions.
//
// Authentication (first match wins):
//   1. GOOGLE_SERVICE_ACCOUNT_JSON  – service-account key JSON. Share the sheet with the
//      service account's client_email as *Viewer* (least privilege, read-only scope).
//   2. GOOGLE_SHEETS_API_KEY        – API key; only works if the sheet is link-shared.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleSheetsError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.status = status;
  }
}

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

let cachedToken: { token: string; exp: number } | null = null;

async function serviceAccountToken(json: string): Promise<string> {
  if (cachedToken && cachedToken.exp - 60 > Date.now() / 1000) return cachedToken.token;
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(json);
  } catch {
    throw new GoogleSheetsError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON', 500);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new GoogleSheetsError(`Google authentication failed (${res.status})`, 502);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return cachedToken.token;
}

async function authorise(): Promise<{ headers: HeadersInit; query: string }> {
  const sa = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (sa) return { headers: { Authorization: `Bearer ${await serviceAccountToken(sa)}` }, query: '' };
  const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
  if (apiKey) return { headers: {}, query: `key=${encodeURIComponent(apiKey)}` };
  throw new GoogleSheetsError(
    'Google Sheets access is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON (recommended) as an Edge Function secret.',
    503,
  );
}

async function getJson(url: string, attempt = 0): Promise<any> {
  const { headers, query } = await authorise();
  const full = query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
  const res = await fetch(full, { headers });
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      return getJson(url, attempt + 1);
    }
  }
  if (res.status === 403 || res.status === 404) {
    throw new GoogleSheetsError(
      'The NPP Google Sheet could not be opened. Check that it is shared with the service account and the spreadsheet ID is correct.',
      res.status,
    );
  }
  if (!res.ok) throw new GoogleSheetsError(`Google Sheets API error (${res.status})`, 502);
  return res.json();
}

/** Resolves a worksheet title from its gid (tab id). Falls back to the provided title. */
export async function resolveSheetTitle(spreadsheetId: string, gid?: number | string | null, fallback?: string) {
  if (gid === undefined || gid === null || gid === '') return fallback ?? 'Sheet1';
  const meta = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`,
  );
  const match = (meta.sheets ?? []).find((s: any) => String(s.properties?.sheetId) === String(gid));
  if (!match) throw new GoogleSheetsError(`Worksheet with gid ${gid} was not found in the spreadsheet`, 404);
  return match.properties.title as string;
}

/** Returns the worksheet's displayed (formatted) values. */
export async function readSheetValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const data = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
      '?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS',
  );
  return (data.values ?? []) as string[][];
}
