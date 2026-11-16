alter table public.readings add column original_data jsonb;
update public.readings r set original_data=to_jsonb(r)-'original_data' where original_data is null;
create function private.preserve_original_reading() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then NEW.original_data=to_jsonb(NEW)-'original_data';
 else NEW.original_data=OLD.original_data;
 end if;
 return NEW;
end $$;
revoke all on function private.preserve_original_reading() from public,anon,authenticated;
create trigger preserve_original_reading before insert or update on public.readings
for each row execute function private.preserve_original_reading();
