import {describe,it,expect} from 'vitest';
import {chatStep,emptyReading,glucose,today,validateReading,verifySignature} from '../supabase/functions/_shared/health';
describe('shared health boundary',()=>{
 it('uses Taipei date across UTC midnight',()=>expect(today(new Date('2026-11-15T17:00:00Z'))).toBe('2026-11-16'));
 it('converts declared units and preserves reported mg/dL',()=>expect(glucose(100,'mg/dL')).toEqual({glucose_mmol:5.56,glucose_mg_reported:100}));
 it('rejects values when unit is wrong',()=>expect(()=>validateReading({...emptyReading(),...glucose(100,'mmol/L')})).toThrow());
 it('rejects missing, invalid dates, NaN and incomplete blood pressure',()=>{
  for(const r of [emptyReading(),{...emptyReading(),measured_on:'2026-02-30',weight_kg:60},{...emptyReading(),weight_kg:NaN},{...emptyReading(),systolic:120}])expect(()=>validateReading(r)).toThrow();
 });
 it('allows date backfill and retains original notes and dual units',()=>{
  const r={...emptyReading(),measured_on:'2025-01-03',glucose_mmol:4.8,glucose_mg_reported:87.2,notes:'合成測試：雙單位不一致，待核對'};expect(validateReading(r)).toEqual(r);
 });
 it('does not save until explicit confirmation, and cancel discards draft',()=>{
  const next=chatStep(`快速 ${today()} 空腹 100 mg/dL 60 120/80 70`,null);expect(next.save).toBeUndefined();expect(next.draft?.step).toBe('confirm');
  expect(chatStep('確認儲存',next.draft).save?.glucose_mg_reported).toBe(100);expect(chatStep('取消',next.draft).draft).toBeNull();
 });
 it('walks through the complete chat entry with skipped fields',()=>{
  let d=chatStep('登記',null).draft;
  for(const text of ['昨天','餐後','100 mg/dL','略過','略過','略過'])d=chatStep(text,d).draft;
  expect(d?.step).toBe('confirm');expect(chatStep('確認儲存',d).save?.measurement_type).toBe('postmeal');
 });
 it('rejects unsigned, tampered and malformed webhooks',async()=>{
  const raw='{"events":[]}',secret='test-only';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)))));
  expect(await verifySignature(raw,sig,secret)).toBe(true);expect(await verifySignature(raw+' ',sig,secret)).toBe(false);expect(await verifySignature(raw,'',secret)).toBe(false);expect(await verifySignature(raw,'???',secret)).toBe(false);
 });
});
