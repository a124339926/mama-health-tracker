alter table public.bot_sessions add column last_event_timestamp bigint not null default 0;
drop function public.commit_bot_event(text,text,integer,jsonb,text,jsonb);
create function public.commit_bot_event(eid text, lid text, expected_version integer, next_draft jsonb, reply_text text, saved jsonb default null, event_ts bigint default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p uuid; v integer; last_ts bigint;
begin
 select version,last_event_timestamp into v,last_ts from public.bot_sessions where line_user_id=lid for update;
 if exists(select 1 from public.webhook_events where event_id=eid) then return true; end if;
 if v is null or v<>expected_version or event_ts<last_ts then return false; end if;
 select patient_id into p from public.line_accounts where line_user_id=lid;
 if saved is not null then
  insert into public.readings(patient_id,measured_on,measured_time,measurement_type,glucose_mmol,glucose_mg_reported,weight_kg,systolic,diastolic,pulse,notes,source,source_key)
  select p,(saved->>'measured_on')::date,nullif(saved->>'measured_time','')::time,saved->>'measurement_type',(saved->>'glucose_mmol')::numeric,(saved->>'glucose_mg_reported')::numeric,(saved->>'weight_kg')::numeric,(saved->>'systolic')::integer,(saved->>'diastolic')::integer,(saved->>'pulse')::integer,coalesce(saved->>'notes',''),'line',eid;
 end if;
 update public.bot_sessions set draft=next_draft,version=version+1,updated_at=now(),last_event_timestamp=event_ts where line_user_id=lid;
 insert into public.webhook_events(event_id,line_user_id,reply) values(eid,lid,reply_text); return true;
end $$;
revoke all on function public.commit_bot_event(text,text,integer,jsonb,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.commit_bot_event(text,text,integer,jsonb,text,jsonb,bigint) to service_role;
