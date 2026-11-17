export class LoginError extends Error {}
export async function verifyLineIdentity(
  token: unknown,
  channel: string,
  request: typeof fetch = fetch,
): Promise<string> {
  if (typeof token !== "string" || !token) {
    throw new LoginError("請使用 LINE 登入");
  }
  const response = await request("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    body: new URLSearchParams({ id_token: token, client_id: channel }),
  });
  const claims = await response.json();
  if (
    !response.ok || typeof claims.sub !== "string" || !claims.sub ||
    claims.aud !== channel || claims.iss !== "https://access.line.me" ||
    typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()
  ) {
    throw new LoginError("LINE 登入已失效，請重新登入");
  }
  return claims.sub;
}
