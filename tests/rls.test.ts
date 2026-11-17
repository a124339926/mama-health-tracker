import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  outsider = "33333333-3333-4333-8333-333333333333",
  editor = "44444444-4444-4444-8444-444444444444";
const patient = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (
    const f of readdirSync("supabase/migrations").filter((f) =>
      f.endsWith(".sql")
    )
  ) await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.exec(
    `insert into auth.users values('${owner}'),('${viewer}'),('${outsider}'),('${editor}');insert into public.patients(id,display_name) values('${patient}','Synthetic A'),('${other}','Synthetic B');insert into public.members values('${patient}','${owner}','owner'),('${patient}','${viewer}','viewer'),('${patient}','${editor}','editor'),('${other}','${outsider}','owner');insert into public.readings(patient_id,measured_on,measurement_type,weight_kg,notes) values('${patient}','2026-10-01','fasting',60,'synthetic');`,
  );
}, 30000);
afterAll(async () => db?.close());
it("keeps the first raw reading and notes even when an editor changes the record", async () => {
  const result = await db.query(
    `update public.readings set notes='edited synthetic note',glucose_mmol=6,original_data='{}' where patient_id='${patient}' returning original_data`,
  );
  expect(
    (result.rows[0] as {
      original_data: { notes: string; glucose_mmol: number | null };
    }).original_data.notes,
  ).toBe("synthetic");
  expect(
    (result.rows[0] as { original_data: { glucose_mmol: number | null } })
      .original_data.glucose_mmol,
  ).toBeNull();
});
async function asUser(uid: string, sql: string) {
  await db.exec("begin");
  try {
    await db.exec(
      `set local role authenticated;select set_config('request.jwt.claim.sub','${uid}',true);`,
    );
    return await db.query(sql);
  } finally {
    await db.exec("rollback");
  }
}
it("legacy email sessions including the former owner have no table access", async () => {
  for (const uid of [owner, viewer, editor, outsider]) {
    for (const table of ["patients", "members", "readings", "line_members"]) {
      await expect(asUser(uid, "select * from public." + table)).rejects
        .toThrow();
    }
  }
});
it("anonymous visitors have no table access", async () => {
  await db.exec("begin;set local role anon");
  try {
    await expect(db.query("select * from public.readings")).rejects.toThrow();
  } finally {
    await db.exec("rollback");
  }
});
it("private codes and LINE identities are inaccessible", async () => {
  for (
    const table of [
      "invites",
      "line_accounts",
      "bot_sessions",
      "webhook_events",
      "reminder_deliveries",
    ]
  ) {
    await expect(asUser(owner, "select * from public." + table)).rejects
      .toThrow();
  }
});
it("privileged provisioning RPC is not publicly executable", async () =>
  await expect(asUser(owner, `select public.create_household('${owner}','no')`))
    .rejects.toThrow());
it("LINE invitation roles are single-use, preserve owners, and revocation removes bot access", async () => {
  await db.exec(
    `insert into public.line_members values('${patient}','line-owner','owner');
    insert into public.invites(hash,patient_id,role) values('viewer-code','${patient}','viewer'),('editor-code','${patient}','editor');`,
  );
  await db.query(
    "select public.accept_line_invite('viewer-code','line-viewer')",
  );
  expect(
    (await db.query(
      "select role from public.line_members where line_user_id='line-viewer'",
    )).rows,
  ).toEqual([{ role: "viewer" }]);
  await expect(
    db.query("select public.accept_line_invite('viewer-code','another-line')"),
  ).rejects.toThrow();
  await expect(
    db.query(
      "select public.commit_bot_event('viewer-save','line-viewer',0,null,'saved',null)",
    ),
  ).rejects.toThrow();
  await db.query(
    "select public.accept_line_invite('editor-code','line-editor')",
  );
  await expect(
    db.query(
      `select public.revoke_line_member('${patient}','line-viewer','line-editor')`,
    ),
  ).rejects.toThrow();
  await db.query(
    `select public.revoke_line_member('${patient}','line-owner','line-editor')`,
  );
  expect(
    (await db.query(
      "select * from public.line_members where line_user_id='line-editor'",
    )).rows,
  ).toHaveLength(0);
  expect(
    (await db.query(
      "select * from public.line_accounts where line_user_id='line-editor'",
    )).rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      `select public.revoke_line_member('${patient}','line-owner','line-owner')`,
    ),
  ).rejects.toThrow();
});
it("new LINE owners create only their own diary and cannot claim existing records", async () => {
  const created = await db.query<{ id: string }>(
    "select public.create_line_household('new-line','Synthetic new') as id",
  );
  expect(created.rows[0].id).not.toBe(patient);
  await expect(
    db.query("select public.create_line_household('new-line','duplicate')"),
  ).rejects.toThrow();
  expect(
    (await db.query(
      "select role from public.line_members where line_user_id='new-line'",
    )).rows,
  ).toEqual([{ role: "owner" }]);
});
it("bot commit is atomic and replay does not duplicate a reading", async () => {
  await db.exec(
    `insert into public.line_members values('${patient}','synthetic-line','editor');insert into public.line_accounts(line_user_id,patient_id) values('synthetic-line','${patient}');insert into public.bot_sessions(line_user_id) values('synthetic-line');`,
  );
  const saved = JSON.stringify({
    measured_on: "2026-10-03",
    measured_time: null,
    measurement_type: "fasting",
    weight_kg: 60,
    notes: "synthetic",
  });
  for (let n = 0; n < 2; n++) {
    await db.query("select public.commit_bot_event($1,$2,$3,$4,$5,$6)", [
      "synthetic-event",
      "synthetic-line",
      0,
      null,
      "saved",
      saved,
    ]);
  }
  expect(
    (await db.query(
      `select * from public.readings where source_key='synthetic-event'`,
    )).rows,
  ).toHaveLength(1);
  expect(
    (await db.query(
      `select public.commit_bot_event('different','synthetic-line',0,null,'stale',null) as ok`,
    )).rows[0],
  ).toEqual({ ok: false });
  await db.query(
    "select public.commit_bot_event('newer','synthetic-line',1,null,'new',null,100)",
  );
  expect(
    (await db.query(
      "select public.commit_bot_event('older','synthetic-line',2,null,'old',null,99) as ok",
    )).rows[0],
  ).toEqual({ ok: false });
});
