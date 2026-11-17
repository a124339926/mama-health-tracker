import { verifyLineIdentity } from "./line-auth.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
export const required = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw Error("Missing server configuration: " + name);
  return v;
};
export const db = () =>
  createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
export function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw Error("資料操作未成功，請稍後再試");
  return result.data;
}
export const cors = (req: Request) => ({
  "Access-Control-Allow-Origin":
    req.headers.get("origin") === Deno.env.get("APP_ORIGIN")
      ? req.headers.get("origin")!
      : "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
export function json(req: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors(req),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
export async function actor(_req: Request, body: Record<string, unknown>) {
  return {
    lineId: await verifyLineIdentity(
      body.line_id_token,
      required("LINE_LOGIN_CHANNEL_ID"),
    ),
  };
}
