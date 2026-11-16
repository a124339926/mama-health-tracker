import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
export const required = (name: string) => { const v = Deno.env.get(name); if (!v) throw Error('Missing server configuration: '+name); return v; };
export const db = () => createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession:false, autoRefreshToken:false } });
export function check<T>(result: { data: T; error: unknown }): T { if(result.error) throw Error('資料操作未成功，請稍後再試'); return result.data; }
export const cors = (req: Request) => ({ 'Access-Control-Allow-Origin': req.headers.get('origin') === Deno.env.get('APP_ORIGIN') ? req.headers.get('origin')! : 'null', 'Access-Control-Allow-Headers':'authorization, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin' });
export function json(req:Request, value:unknown, status=200) { return new Response(JSON.stringify(value), { status,headers:{...cors(req),'content-type':'application/json','cache-control':'no-store'} }); }
export async function actor(req:Request, body:Record<string,unknown>) {
 if (body.line_id_token) {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',body:new URLSearchParams({id_token:String(body.line_id_token),client_id:required('LINE_LOGIN_CHANNEL_ID')})});
  const token=await res.json(); if(!res.ok || !token.sub || token.aud!==required('LINE_LOGIN_CHANNEL_ID') || token.exp*1000<=Date.now()) throw Error('LINE 登入已失效，請重新開啟表單');
  const link=check(await db().from('line_accounts').select('patient_id,line_user_id').eq('line_user_id',token.sub).maybeSingle());
  if(!link) throw Error('請先在網頁產生代碼並於 LINE 完成綁定');
  return {uid:null,lineId:String(token.sub),patientId:link.patient_id};
 }
 const bearer=req.headers.get('authorization')?.replace(/^Bearer /,''); if(!bearer) throw Error('請先登入');
 const {data,error}=await db().auth.getUser(bearer); if(error || !data.user) throw Error('登入已失效，請重新登入');
 return {uid:data.user.id,lineId:null,patientId:null};
}
