create schema if not exists private;
revoke all on schema private from public;
create table public.patients (
 id uuid primary key default gen_random_uuid(), display_name text not null check(length(display_name) between 1 and 80), created_at timestamptz not null default now()
);
create table public.members (
 patient_id uuid not null references public.patients on delete cascade,
 user_id uuid not null references auth.users on delete cascade,
 role text not null check(role in ('owner','editor','viewer')),
 primary key(patient_id,user_id)
);
create table public.readings (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients on delete cascade,
 measured_on date not null, measured_time time, measurement_type text not null check(measurement_type in ('fasting','postmeal','other')),
 glucose_mmol numeric, glucose_mg_reported numeric, weight_kg numeric, systolic integer, diastolic integer, pulse integer,
 notes text not null default '' check(length(notes)<=2000), source text not null default 'web', source_key text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(patient_id,source_key), check(num_nonnulls(glucose_mmol,weight_kg,systolic,pulse)>0),
 check((systolic is null)=(diastolic is null))
);
create index readings_patient_date on public.readings(patient_id,measured_on);
create index members_user on public.members(user_id);
create table public.invites (
 hash text primary key, patient_id uuid not null references public.patients on delete cascade,
 role text not null check(role in ('editor','viewer','line')), expires_at timestamptz not null default now()+interval '15 minutes'
);
create table public.line_accounts (
 line_user_id text primary key, patient_id uuid not null references public.patients on delete cascade,
 reminders_enabled boolean not null default false, daily_hour integer not null default 8 check(daily_hour between 0 and 23),
 missed_hour integer not null default 20 check(missed_hour between 0 and 23)
);
create table public.bot_sessions (
 line_user_id text primary key references public.line_accounts on delete cascade,
 draft jsonb, version integer not null default 0, updated_at timestamptz not null default now()
);
create table public.webhook_events (
 event_id text primary key, line_user_id text not null, reply text not null, created_at timestamptz not null default now()
);
create table public.reminder_deliveries (
 id uuid primary key default gen_random_uuid(), line_user_id text not null references public.line_accounts on delete cascade,
 measured_on date not null, kind text not null check(kind in ('daily','missed')), status text not null default 'sending',
 created_at timestamptz not null default now(), unique(line_user_id,measured_on,kind)
);
alter table public.patients enable row level security;
alter table public.members enable row level security;
alter table public.readings enable row level security;
alter table public.invites enable row level security;
alter table public.line_accounts enable row level security;
alter table public.bot_sessions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.reminder_deliveries enable row level security;
revoke all on public.patients,public.members,public.readings,public.invites,public.line_accounts,public.bot_sessions,public.webhook_events,public.reminder_deliveries from anon,authenticated;
grant select on public.patients,public.members to authenticated;
grant select,insert,update,delete on public.readings to authenticated;
grant all on public.patients,public.members,public.readings,public.invites,public.line_accounts,public.bot_sessions,public.webhook_events,public.reminder_deliveries to service_role;
create function private.has_access(p uuid, write_access boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.patient_id=p and m.user_id=(select auth.uid()) and (not write_access or m.role in ('owner','editor')))
$$;
revoke all on function private.has_access(uuid,boolean) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_access(uuid,boolean) to authenticated;
create policy patients_read on public.patients for select to authenticated using(private.has_access(id));
create policy members_read on public.members for select to authenticated using(private.has_access(patient_id));
create policy readings_read on public.readings for select to authenticated using(private.has_access(patient_id));
create policy readings_insert on public.readings for insert to authenticated with check(private.has_access(patient_id,true));
create policy readings_update on public.readings for update to authenticated using(private.has_access(patient_id,true)) with check(private.has_access(patient_id,true));
create policy readings_delete on public.readings for delete to authenticated using(private.has_access(patient_id,true));
create function public.create_household(actor uuid, label text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare p uuid;
begin
 if exists(select 1 from public.members where user_id=actor) then raise exception 'already a member'; end if;
 insert into public.patients(display_name) values(label) returning id into p;
 insert into public.members values(p,actor,'owner'); return p;
end $$;
create function public.accept_invite(code_hash text, actor uuid default null, line_actor text default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare i public.invites;
begin
 delete from public.invites where hash=code_hash and expires_at>now() and ((role='line' and line_actor is not null and actor is null) or (role<>'line' and actor is not null and line_actor is null)) returning * into i;
 if i.hash is null then raise exception 'invalid or expired code'; end if;
 if i.role='line' then
  insert into public.line_accounts(line_user_id,patient_id) values(line_actor,i.patient_id);
  insert into public.bot_sessions(line_user_id) values(line_actor);
 else insert into public.members values(i.patient_id,actor,i.role) on conflict do nothing; end if;
 return i.patient_id;
end $$;
create function public.commit_bot_event(eid text, lid text, expected_version integer, next_draft jsonb, reply_text text, saved jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p uuid; v integer;
begin
 select version into v from public.bot_sessions where line_user_id=lid for update;
 if exists(select 1 from public.webhook_events where event_id=eid) then return true; end if;
 if v is null or v<>expected_version then return false; end if;
 select patient_id into p from public.line_accounts where line_user_id=lid;
 if saved is not null then
  insert into public.readings(patient_id,measured_on,measured_time,measurement_type,glucose_mmol,glucose_mg_reported,weight_kg,systolic,diastolic,pulse,notes,source,source_key)
  select p,(saved->>'measured_on')::date,nullif(saved->>'measured_time','')::time,saved->>'measurement_type',(saved->>'glucose_mmol')::numeric,(saved->>'glucose_mg_reported')::numeric,(saved->>'weight_kg')::numeric,(saved->>'systolic')::integer,(saved->>'diastolic')::integer,(saved->>'pulse')::integer,coalesce(saved->>'notes',''),'line',eid;
 end if;
 update public.bot_sessions set draft=next_draft,version=version+1,updated_at=now() where line_user_id=lid;
 insert into public.webhook_events(event_id,line_user_id,reply) values(eid,lid,reply_text); return true;
end $$;
revoke all on function public.create_household(uuid,text),public.accept_invite(text,uuid,text),public.commit_bot_event(text,text,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_household(uuid,text),public.accept_invite(text,uuid,text),public.commit_bot_event(text,text,integer,jsonb,text,jsonb) to service_role;
