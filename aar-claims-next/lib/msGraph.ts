// Delegated OAuth for "Connect your Microsoft account" — the signed-in
// user consents for themselves, no tenant admin required unless the org
// has blocked user consent entirely. Same pattern as the earlier FastAPI
// version, ported to Next.js API routes.

const AUTHORITY = "https://login.microsoftonline.com";
const SCOPES = "offline_access Files.Read Files.Read.All User.Read";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export function buildAuthorizeUrl(state: string): string {
  const tenantId = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const redirectUri = requireEnv("MS_OAUTH_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${AUTHORITY}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const tenantId = requireEnv("MS_TENANT_ID");
  const res = await fetch(`${AUTHORITY}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("MS_CLIENT_ID"),
      client_secret: requireEnv("MS_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: requireEnv("MS_OAUTH_REDIRECT_URI"),
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string) {
  const tenantId = requireEnv("MS_TENANT_ID");
  const res = await fetch(`${AUTHORITY}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("MS_CLIENT_ID"),
      client_secret: requireEnv("MS_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
  return res.json();
}

export function isMsOAuthConfigured(): boolean {
  return !!(
    process.env.MS_TENANT_ID &&
    process.env.MS_CLIENT_ID &&
    process.env.MS_CLIENT_SECRET &&
    process.env.MS_OAUTH_REDIRECT_URI
  );
}

// Lists a folder's contents via delegated Graph access, and downloads a
// specific item's bytes. No app registration beyond the OAuth app itself.
//
// BUG FIX: this used to do
//   `root:/${encodeURIComponent(folderPath)}:/children`
// which breaks in two ways:
//   1. encodeURIComponent() escapes "/" as "%2F", so any nested path
//      (e.g. "QA DATA SOURCE FILES/2024") got sent as one literal
//      segment containing "%2F" instead of separate path segments —
//      Graph rejects this (404), so subfolder browsing never worked.
//   2. When folderPath is empty (browsing the root), the old code
//      produced ".../root:/:/children", which isn't a valid Graph path
//      form — the root has no ":path:" segment; it must be addressed as
//      ".../root/children" directly.
// Fix: encode each path segment individually and join with literal "/",
// and branch to the plain root/children endpoint when there's no path.
export async function listFolder(accessToken: string, folderPath: string) {
  const trimmed = folderPath.trim().replace(/^\/+|\/+$/g, "");
  const url = trimmed
    ? `https://graph.microsoft.com/v1.0/me/drive/root:/${trimmed
        .split("/")
        .map(encodeURIComponent)
        .join("/")}:/children`
    : `https://graph.microsoft.com/v1.0/me/drive/root/children`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Graph list folder failed: ${await res.text()}`);
  const body = await res.json();
  return body.value as Array<{
    id: string;
    name: string;
    size: number;
    "@microsoft.graph.downloadUrl"?: string;
    file?: unknown;
    folder?: unknown;
  }>;
}

export async function downloadFile(downloadUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Graph file download failed: ${res.statusText}`);
  return res.arrayBuffer();
}
