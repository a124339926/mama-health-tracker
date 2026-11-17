-- LINE identities are verified server-side; no client role can query these tables.
create table public.line_members (
 patient_id uuid not null references public.patients on delete cascade,
 line_user_id text not null,
 role text not null check(role in ('owner','editor','viewer')),
 primary key(patient_id,line_user_id)
);
create index line_members_user on public.line_members(line_user_id);
alter table public.line_members enable row level security;
revoke all on public.line_members from public,anon,authenticated;
grant all on public.line_members to service_role;
insert into public.line_members select patient_id,line_user_id,'editor' from public.line_accounts;
-- Existing email sessions no longer grant health-data access.
revoke all on public.patients,public.members,public.readings from anon,authenticated;
revoke execute on function public.create_household(uuid,text),public.accept_invite(text,uuid,text) from service_role;

create function public.create_line_household(actor text,label text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare p uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor,0));
 if actor is null or length(actor)=0 then raise exception 'missing identity'; end if;
 if exists(select 1 from public.line_members where line_user_id=actor) then raise exception 'already a member'; end if;
 insert into public.patients(display_name) values(label) returning id into p;
 insert into public.line_members values(p,actor,'owner');
 insert into public.line_accounts(line_user_id,patient_id) values(actor,p);
 insert into public.bot_sessions(line_user_id) values(actor);
 return p;
end $$;
create function public.accept_line_invite(code_hash text,actor text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare i public.invites;
begin
 if actor is null or length(actor)=0 then raise exception 'missing identity'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor,0));
 delete from public.invites where hash=code_hash and expires_at>now() returning * into i;
 if i.hash is null then raise exception 'invalid or expired code'; end if;
 if exists(select 1 from public.line_accounts where line_user_id=actor and patient_id<>i.patient_id) then raise exception 'already bound to another diary'; end if;
 insert into public.line_members values(i.patient_id,actor,case when i.role='line' then 'editor' else i.role end)
 on conflict(patient_id,line_user_id) do update set role=case when line_members.role='owner' then 'owner' else excluded.role end;
 insert into public.line_accounts(line_user_id,patient_id) values(actor,i.patient_id) on conflict do nothing;
 insert into public.bot_sessions(line_user_id) values(actor) on conflict do nothing;
 return i.patient_id;
end $$;
create function public.revoke_line_member(patient uuid,actor text,target text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if actor=target or not exists(select 1 from public.line_members where patient_id=patient and line_user_id=actor and role='owner') then raise exception 'forbidden'; end if;
 delete from public.line_members where patient_id=patient and line_user_id=target and role<>'owner';
 if found then delete from public.line_accounts where patient_id=patient and line_user_id=target; end if;
end $$;
revoke all on function public.create_line_household(text,text),public.accept_line_invite(text,text),public.revoke_line_member(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_line_household(text,text),public.accept_line_invite(text,text),public.revoke_line_member(uuid,text,text) to service_role;

create or replace function public.commit_bot_event(eid text, lid text, expected_version integer, next_draft jsonb, reply_text text, saved jsonb default null, event_ts bigint default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p uuid; v integer; last_ts bigint;
begin
 select version,last_event_timestamp into v,last_ts from public.bot_sessions where line_user_id=lid for update;
 if exists(select 1 from public.webhook_events where event_id=eid) then return true; end if;
 if v is null or v<>expected_version or event_ts<last_ts then return false; end if;
 select patient_id into p from public.line_accounts where line_user_id=lid;
 if p is null or not exists(select 1 from public.line_members where patient_id=p and line_user_id=lid and role in ('owner','editor')) then raise exception 'forbidden'; end if;
 if saved is not null then
  insert into public.readings(patient_id,measured_on,measured_time,measurement_type,glucose_mmol,glucose_mg_reported,weight_kg,systolic,diastolic,pulse,notes,source,source_key)
  select p,(saved->>'measured_on')::date,nullif(saved->>'measured_time','')::time,saved->>'measurement_type',(saved->>'glucose_mmol')::numeric,(saved->>'glucose_mg_reported')::numeric,(saved->>'weight_kg')::numeric,(saved->>'systolic')::integer,(saved->>'diastolic')::integer,(saved->>'pulse')::integer,coalesce(saved->>'notes',''),'line',eid;
 end if;
 update public.bot_sessions set draft=next_draft,version=version+1,updated_at=now(),last_event_timestamp=event_ts where line_user_id=lid;
 insert into public.webhook_events(event_id,line_user_id,reply) values(eid,lid,reply_text); return true;
end $$;
revoke all on function public.commit_bot_event(text,text,integer,jsonb,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.commit_bot_event(text,text,integer,jsonb,text,jsonb,bigint) to service_role;
