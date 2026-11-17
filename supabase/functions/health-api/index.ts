import { LoginError } from "../_shared/line-auth.ts";
import { actor, check, db, json } from "../_shared/server.ts";
import { sha256, validateReading } from "../_shared/health.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, {});
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }
  try {
    const b = await req.json();
    const who = await actor(req, b);
    const client = db();
    if (b.action === "create") {
      return json(req, {
        patientId: check(
          await client.rpc("create_line_household", {
            actor: who.lineId,
            label: "媽媽",
          }),
        ),
      });
    }
    if (b.action === "join") {
      return json(req, {
        patientId: check(
          await client.rpc("accept_line_invite", {
            code_hash: await sha256(String(b.code)),
            actor: who.lineId,
          }),
        ),
      });
    }
    const membership = check(
      await client.from("line_members").select("patient_id,role").eq(
        "line_user_id",
        who.lineId,
      ),
    );
    const pid = b.patientId || membership?.[0]?.patient_id;
    const role = membership?.find((m) => m.patient_id === pid)?.role;
    if (!role) {
      return json(
        req,
        { error: "尚未獲得家屬授權，請建立日記或輸入邀請碼" },
        403,
      );
    }
    if (b.action === "load") {
      const patient = check(
        await client.from("patients").select("*").eq("id", pid).single(),
      );
      const readings = check(
        await client.from("readings").select("*").eq("patient_id", pid).order(
          "measured_on",
        ).order("measured_time", { nullsFirst: true }),
      );
      const members = role === "owner"
        ? check(
          await client.from("line_members").select("line_user_id,role").eq(
            "patient_id",
            pid,
          ),
        )
        : [];
      const links = role === "owner"
        ? check(
          await client.from("line_accounts").select(
            "line_user_id,reminders_enabled,daily_hour,missed_hour",
          ).eq("patient_id", pid),
        )
        : [];
      return json(req, { patient, readings, role, members, links });
    }
    if (b.action === "save" && role !== "viewer") {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.requestId))) {
        throw Error("Missing request ID");
      }
      const r = validateReading(b.reading);
      const fields = {
        measured_on: r.measured_on,
        measured_time: r.measured_time || null,
        measurement_type: r.measurement_type,
        glucose_mmol: r.glucose_mmol,
        glucose_mg_reported: r.glucose_mg_reported,
        weight_kg: r.weight_kg,
        systolic: r.systolic,
        diastolic: r.diastolic,
        pulse: r.pulse,
        notes: r.notes,
        updated_at: new Date().toISOString(),
      };
      if (r.id) {
        check(
          await client.from("readings").update(fields).eq("id", r.id).eq(
            "patient_id",
            pid,
          ).select().single(),
        );
      } else {check(
          await client.from("readings").upsert({
            ...fields,
            patient_id: pid,
            source: who.lineId ? "liff" : "web",
            source_key: "manual:" + String(b.requestId),
          }, { onConflict: "patient_id,source_key", ignoreDuplicates: true }),
        );}
      return json(req, { ok: true });
    }
    if (
      b.action === "invite" && role === "owner" &&
      ["line", "viewer", "editor"].includes(b.role)
    ) {
      const code = crypto.randomUUID().replaceAll("-", "");
      check(
        await client.from("invites").insert({
          hash: await sha256(code),
          patient_id: pid,
          role: b.role,
        }),
      );
      return json(req, { code });
    }
    if (b.action === "revoke" && role === "owner") {
      check(
        await client.rpc("revoke_line_member", {
          patient: pid,
          actor: who.lineId,
          target: b.lineId,
        }),
      );
      return json(req, { ok: true });
    }
    if (b.action === "unlink" && role === "owner") {
      check(
        await client.from("line_accounts").delete().eq("patient_id", pid).eq(
          "line_user_id",
          b.lineId,
        ),
      );
      return json(req, { ok: true });
    }
    if (
      b.action === "reminders" && (role === "owner" || b.lineId === who.lineId)
    ) {
      const daily = Number(b.daily), missed = Number(b.missed);
      if (
        !Number.isInteger(daily) || !Number.isInteger(missed) || daily < 0 ||
        daily > 23 || missed < 0 || missed > 23
      ) throw Error("提醒時間請填 0 至 23 點");
      check(
        await client.from("line_accounts").update({
          reminders_enabled: b.enabled === true,
          daily_hour: daily,
          missed_hour: missed,
        }).eq("patient_id", pid).eq(
          "line_user_id",
          role === "owner" ? b.lineId : who.lineId,
        ),
      );
      return json(req, { ok: true });
    }
    return json(req, { error: "沒有此操作的權限" }, 403);
  } catch (error) {
    if (error instanceof LoginError) {
      return json(req, { error: error.message }, 401);
    }
    return json(req, {
      error: "操作未完成。請檢查登入、邀請碼、數值或網路後再試。",
    }, 400);
  }
});
