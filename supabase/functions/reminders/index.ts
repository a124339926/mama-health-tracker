import {check,db,required} from '../_shared/server.ts';
import {today} from '../_shared/health.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(req.headers.get('authorization')!=='Bearer '+required('REMINDER_SECRET'))return new Response('Unauthorized',{status:401});
 try{
  const client=db(),date=today(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const accounts=check(await client.from('line_accounts').select('*').eq('reminders_enabled',true))||[];let sent=0;
  for(const account of accounts){
   for(const kind of ['daily','missed'] as const){
    if(hour!==account[kind==='daily'?'daily_hour':'missed_hour'])continue;
    if(kind==='missed') { const r=check(await client.from('readings').select('id').eq('patient_id',account.patient_id).eq('measured_on',date).limit(1));if(r?.length)continue; }
    const claimed=await client.from('reminder_deliveries').insert({line_user_id:account.line_user_id,measured_on:date,kind}).select('id,status,created_at').single();
    let delivery=claimed.data;
    if(claimed.error){
     if(claimed.error.code!=='23505')throw Error('Cannot claim reminder');
     delivery=check(await client.from('reminder_deliveries').select('id,status,created_at').eq('line_user_id',account.line_user_id).eq('measured_on',date).eq('kind',kind).single());
     if(!delivery)throw Error('Missing reminder claim');
     if(delivery.status==='sent'||(delivery.status==='sending'&&Date.now()-Date.parse(delivery.created_at)<5*60000))continue;
    }
    if(!delivery)throw Error('Missing reminder claim');
    // No values are included in push notifications, which may appear on the lock screen.
    const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+required('LINE_CHANNEL_ACCESS_TOKEN'),'content-type':'application/json','X-Line-Retry-Key':delivery.id},body:JSON.stringify({to:account.line_user_id,messages:[{type:'text',text:kind==='daily'?'早安，今天也記一下健康數據。回覆「登記」逐項填寫，或「表單」開啟網頁。':'今天還沒有健康紀錄。方便時回覆「登記」；已經量過，也可以補登。'}]})});
    const accepted=response.ok||response.status===409;
    check(await client.from('reminder_deliveries').update({status:accepted?'sent':'failed'}).eq('id',delivery.id));
    if(accepted)sent++;
   }
  }
  // Retain only a limited amount of private chat state and deduplication metadata.
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  check(await client.from('webhook_events').delete().lt('created_at',cutoff));
  return Response.json({sent});
 }catch{return new Response('Reminder failed',{status:500});}
});
