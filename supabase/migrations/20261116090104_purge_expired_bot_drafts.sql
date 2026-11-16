create function private.cleanup_bot_data() returns void
language sql security invoker set search_path='' as $$
 update public.bot_sessions set draft=null,version=version+1 where draft is not null and updated_at<now()-interval '30 minutes';
 delete from public.webhook_events where created_at<now()-interval '30 days';
 delete from public.invites where expires_at<now();
$$;
revoke all on function private.cleanup_bot_data() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.cleanup_bot_data() to service_role;
