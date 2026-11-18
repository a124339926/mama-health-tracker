import { check, db, required } from "../_shared/server.ts";
import {
  buttonsFor,
  chatStep,
  type Draft,
  sha256,
  verifySignature,
} from "../_shared/health.ts";
type Event = {
  type: string;
  webhookEventId: string;
  timestamp: number;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};
async function reply(
  token: string,
  text: string,
  labels: string[] = buttonsFor(),
) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + required("LINE_CHANNEL_ACCESS_TOKEN"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken: token,
      messages: [{
        type: "text",
        text,
        ...(labels.length
          ? {
            quickReply: {
              items: labels.map((label) => ({
                type: "action",
                action: { type: "message", label, text: label },
              })),
            },
          }
          : {}),
      }],
    }),
  });
  if (!res.ok) throw Error("LINE reply failed");
}
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const raw = await req.text();
  if (
    !await verifySignature(
      raw,
      req.headers.get("x-line-signature") || "",
      required("LINE_CHANNEL_SECRET"),
    )
  ) return new Response("Invalid signature", { status: 401 });
  try {
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.events)) {
      return new Response("Invalid payload", { status: 400 });
    }
    const client = db();
    for (const event of payload.events as Event[]) {
      // Never echo medical records to group or room conversations.
      if (event.source?.type !== "user" || !event.source.userId) continue;
      const lid = event.source.userId;
      if (event.type === "unfollow") {
        check(
          await client.from("line_accounts").update({
            reminders_enabled: false,
          }).eq("line_user_id", lid),
        );
        continue;
      }
      const account = check(
        await client.from("line_accounts").select("patient_id").eq(
          "line_user_id",
          lid,
        ).maybeSingle(),
      );
      if (event.type === "follow" && event.replyToken) {
        await reply(
          event.replyToken,
          account
            ? "歡迎回來！直接輸入血糖數字即可。"
            : "第一次使用，請向家屬取得代碼，再輸入「綁定 代碼」。",
          account ? buttonsFor() : [],
        );
        continue;
      }
      if (
        event.type !== "message" || event.message?.type !== "text" ||
        !event.replyToken
      ) continue;
      const text = event.message.text?.trim() || "";
      if (text.startsWith("綁定 ")) {
        const result = await client.rpc("accept_line_invite", {
          code_hash: await sha256(text.slice(3).trim()),
          actor: lid,
        });
        await reply(
          event.replyToken,
          result.error
            ? (account
              ? "這個帳號已連到日記，可以直接輸入血糖數字。"
              : "代碼無效，請向家屬取得新代碼。")
            : "已連到日記！直接輸入血糖數字即可。",
        );
        continue;
      }
      if (!account) {
        await reply(
          event.replyToken,
          "第一次使用，請向家屬取得代碼，再輸入「綁定 代碼」。",
          [],
        );
        continue;
      }
      if (text === "表單") {
        await reply(
          event.replyToken,
          "開啟登記表單：https://liff.line.me/" + required("LIFF_ID"),
        );
        continue;
      }
      const member = check(
        await client.from("line_members").select("role").eq(
          "patient_id",
          account.patient_id,
        ).eq("line_user_id", lid).maybeSingle(),
      );
      if (!member || member.role === "viewer") {
        await reply(
          event.replyToken,
          "目前沒有編輯權限。請回覆「表單」查看日記，或請管理者授權。",
        );
        continue;
      }
      const previous = check(
        await client.from("webhook_events").select("reply").eq(
          "event_id",
          event.webhookEventId,
        ).maybeSingle(),
      );
      if (previous) {
        await reply(event.replyToken, previous.reply);
        continue;
      }
      let completed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const session = check(
          await client.from("bot_sessions").select(
            "draft,version,updated_at,last_event_timestamp",
          )
            .eq("line_user_id", lid).single(),
        );
        if (!session) throw Error("Missing chat session");
        if (!Number.isFinite(event.timestamp)) {
          throw Error("Missing event timestamp");
        }
        if (event.timestamp < session.last_event_timestamp) {
          await reply(
            event.replyToken,
            "較早的訊息已略過，請重新回覆目前步驟，或輸入「登記」重新開始。",
          );
          completed = true;
          break;
        }
        const stale =
          Date.now() - Date.parse(session.updated_at) > 30 * 60 * 1000;
        let next;
        try {
          next = chatStep(
            text,
            stale ? null : session.draft as Draft | null,
            new Date(event.timestamp),
          );
        } catch (e) {
          await reply(
            event.replyToken,
            (e as Error).message,
            buttonsFor(stale ? undefined : session.draft?.step),
          );
          completed = true;
          break;
        }
        const ok = check(
          await client.rpc("commit_bot_event", {
            eid: event.webhookEventId,
            lid,
            expected_version: session.version,
            event_ts: event.timestamp,
            next_draft: next.draft,
            reply_text: next.reply,
            saved: next.save || null,
          }),
        );
        if (ok) {
          const committed = check(
            await client.from("webhook_events").select("reply").eq(
              "event_id",
              event.webhookEventId,
            ).single(),
          );
          if (!committed) throw Error("Missing committed event");
          await reply(
            event.replyToken,
            committed.reply,
            buttonsFor(next.draft?.step),
          );
          completed = true;
          break;
        }
      }
      if (!completed) throw Error("Concurrent update");
    }
    return new Response("OK");
  } catch {
    return new Response("Retry later", { status: 500 });
  }
});
