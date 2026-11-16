import {publicConfig} from './public-config';
import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL||publicConfig.url;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||publicConfig.key;
export const configured=Boolean(url && key);
export const supabase=configured?createClient(url,key):null;
let lineToken:string|null=null;
export async function initLine() {
 if(!new URLSearchParams(location.search).has('liff') && !new URLSearchParams(location.search).has('liff.state')) return false;
 if(!(import.meta.env.VITE_LIFF_ID||publicConfig.liffId)) throw Error('LINE 表單尚未設定，請聯絡家屬');
 const liff=(await import('@line/liff')).default;
 await liff.init({liffId:import.meta.env.VITE_LIFF_ID||publicConfig.liffId});
 if(!liff.isLoggedIn()) { liff.login({redirectUri:location.href}); return false; }
 lineToken=liff.getIDToken(); if(!lineToken) throw Error('請為 LIFF 啟用 openid 權限'); return true;
}
export async function api(action:string, body:Record<string,unknown>={}) {
 if(!supabase) throw Error('網站尚未完成資料庫設定');
 const token=(await supabase.auth.getSession()).data.session?.access_token;
 const res=await fetch(`${url}/functions/v1/health-api`,{method:'POST',headers:{'content-type':'application/json',apikey:key,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,...body,...(lineToken?{line_id_token:lineToken}:{})})});
 const data=await res.json(); if(!res.ok) throw Error(data.error||'連線未完成，請稍後再試'); return data;
}
