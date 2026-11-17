import { publicConfig } from "./public-config";
const url = import.meta.env.VITE_SUPABASE_URL || publicConfig.url;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicConfig.key;
const liffId = import.meta.env.VITE_LIFF_ID || publicConfig.liffId;
export const configured = Boolean(url && key && liffId);
let line: Promise<typeof import("@line/liff")["default"]> | undefined;
function sdk() {
  return line ??= (async () => {
    const liff = (await import("@line/liff")).default;
    await liff.init({ liffId });
    return liff;
  })().catch((e) => {
    line = undefined;
    throw e;
  });
}
export async function initLine() {
  const liff = await sdk();
  if (!liff.isLoggedIn()) {
    if (new URLSearchParams(location.search).has("liff")) await loginLine();
    return false;
  }
  return Boolean(liff.getIDToken());
}
export async function loginLine() {
  const liff = await sdk();
  if (!liff.isLoggedIn()) {
    liff.login({
      redirectUri: location.origin + location.pathname + "?liff=1",
    });
  } else location.reload();
}
export async function logoutLine() {
  const liff = await sdk();
  if (liff.isLoggedIn()) liff.logout();
  // Remove legacy email sessions from this browser as part of the transition.
  for (const name of Object.keys(localStorage)) {
    if (name === "sb-gwoddgjtlhkwnqkzaszu-auth-token") {
      localStorage.removeItem(name);
    }
  }
  location.replace(location.pathname);
}
export async function api(action: string, body: Record<string, unknown> = {}) {
  if (!configured) throw Error("網站尚未完成設定");
  const liff = await sdk();
  const token = liff.isLoggedIn() ? liff.getIDToken() : null;
  if (!token) {
    window.dispatchEvent(new Event("line-session-expired"));
    throw Error("請使用 LINE 重新登入");
  }
  const res = await fetch(`${url}/functions/v1/health-api`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key },
    body: JSON.stringify({ ...body, action, line_id_token: token }),
  });
  const data = await res.json();
  if (res.status === 401) {
    liff.logout();
    window.dispatchEvent(new Event("line-session-expired"));
  }
  if (!res.ok) throw Error(data.error || "連線未完成，請稍後再試");
  return data;
}
