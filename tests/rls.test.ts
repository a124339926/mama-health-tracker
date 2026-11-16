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
it("outsider cannot read another family records", async () =>
  expect((await asUser(outsider, "select * from public.readings")).rows)
    .toHaveLength(0));
it("viewer may read but cannot write", async () => {
  expect((await asUser(viewer, "select * from public.readings")).rows)
    .toHaveLength(1);
  await expect(
    asUser(
      viewer,
      `insert into public.readings(patient_id,measured_on,measurement_type,weight_kg) values('${patient}','2026-10-02','fasting',60)`,
    ),
  ).rejects.toThrow();
});
it("editor can write only to their family", async () => {
  await expect(
    asUser(
      editor,
      `insert into public.readings(patient_id,measured_on,measurement_type,weight_kg) values('${patient}','2026-10-02','fasting',60)`,
    ),
  ).resolves.toBeDefined();
  await expect(
    asUser(
      editor,
      `insert into public.readings(patient_id,measured_on,measurement_type,weight_kg) values('${other}','2026-10-02','fasting',60)`,
    ),
  ).rejects.toThrow();
});
it("cannot move a reading to another family", async () =>
  await expect(
    asUser(
      owner,
      `update public.readings set patient_id='${other}' where patient_id='${patient}'`,
    ),
  ).rejects.toThrow());
it("membership cannot be escalated by the caller", async () =>
  await expect(
    asUser(
      viewer,
      `update public.members set role='owner' where user_id='${viewer}'`,
    ),
  ).rejects.toThrow());
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
it("revoking membership immediately removes access", async () => {
  await db.exec(`delete from public.members where user_id='${viewer}'`);
  expect((await asUser(viewer, "select * from public.readings")).rows)
    .toHaveLength(0);
});
it("bot commit is atomic and replay does not duplicate a reading", async () => {
  await db.exec(
    `insert into public.line_accounts(line_user_id,patient_id) values('synthetic-line','${patient}');insert into public.bot_sessions(line_user_id) values('synthetic-line');`,
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
