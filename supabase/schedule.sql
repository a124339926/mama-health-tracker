-- Run only on the dedicated Mama Health project, after installing pg_cron/pg_net
-- and creating Vault secret mama_reminder_secret. This file contains no secret values.
select cron.schedule('mama-cleanup', '*/10 * * * *', $$ select private.cleanup_bot_data(); $$);
select cron.schedule('mama-reminders', '*/10 * * * *', $$
 select net.http_post(
   url := 'https://gwoddgjtlhkwnqkzaszu.supabase.co/functions/v1/reminders',
   headers := jsonb_build_object('content-type','application/json','Authorization','Bearer ' ||
     (select decrypted_secret from vault.decrypted_secrets where name='mama_reminder_secret')),
   body := '{}'::jsonb
 );
$$);
