import { describe, expect, it } from "vitest";
import {
  chatStep,
  emptyReading,
  glucose,
  today,
  validateReading,
  verifySignature,
} from "../supabase/functions/_shared/health";
describe("shared health boundary", () => {
  it("uses Taipei date across UTC midnight", () =>
    expect(today(new Date("2026-11-15T17:00:00Z"))).toBe("2026-11-16"));
  it("converts declared units and preserves reported mg/dL", () =>
    expect(glucose(100, "mg/dL")).toEqual({
      glucose_mmol: 5.56,
      glucose_mg_reported: 100,
    }));
  it("rejects values when unit is wrong", () =>
    expect(() =>
      validateReading({ ...emptyReading(), ...glucose(100, "mmol/L") })
    ).toThrow());
  it("rejects missing, invalid dates, NaN and incomplete blood pressure", () => {
    for (
      const r of [
        emptyReading(),
        { ...emptyReading(), measured_on: "2026-02-30", weight_kg: 60 },
        { ...emptyReading(), weight_kg: NaN },
        { ...emptyReading(), systolic: 120 },
      ]
    ) expect(() => validateReading(r)).toThrow();
  });
  it("allows date backfill and retains original notes and dual units", () => {
    const r = {
      ...emptyReading(),
      measured_on: "2025-01-03",
      glucose_mmol: 4.8,
      glucose_mg_reported: 87.2,
      notes: "合成測試：雙單位不一致，待核對",
    };
    expect(validateReading(r)).toEqual(r);
  });
  it("does not save until explicit confirmation, and cancel discards draft", () => {
    const next = chatStep(`快速 ${today()} 空腹 100 mg/dL 60 120/80 70`, null);
    expect(next.save).toBeUndefined();
    expect(next.draft?.step).toBe("confirm");
    expect(chatStep("確認儲存", next.draft).save?.glucose_mg_reported).toBe(
      100,
    );
    expect(chatStep("取消", next.draft).draft).toBeNull();
  });
  it("walks through the complete chat entry with skipped fields", () => {
    let d = chatStep("登記", null).draft;
    for (const text of ["昨天", "餐後", "100 mg/dL", "略過", "略過", "略過"]) {
      d = chatStep(text, d).draft;
    }
    expect(d?.step).toBe("confirm");
    expect(chatStep("確認儲存", d).save?.measurement_type).toBe("postmeal");
  });
  it("rejects unsigned, tampered and malformed webhooks", async () => {
    const raw = '{"events":[]}', secret = "test-only";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
        ),
      ),
    );
    expect(await verifySignature(raw, sig, secret)).toBe(true);
    expect(await verifySignature(raw + " ", sig, secret)).toBe(false);
    expect(await verifySignature(raw, "", secret)).toBe(false);
    expect(await verifySignature(raw, "???", secret)).toBe(false);
  });
});

it("saves each sugar separately with Taipei time, optional extras, and no binding prompts", () => {
  const at = new Date("2026-11-15T17:20:00Z");
  expect(chatStep("哈囉", null).reply).not.toContain("綁定");
  for (const label of ["空腹", "餐後", "餐後", "睡前"]) {
    let d = chatStep("５．６", null, at).draft;
    d = chatStep(label, d).draft;
    expect(d?.reading.measured_time).toBe("01:20");
    expect(d?.reading.measured_on).toBe("2026-11-16");
    if (label === "睡前") {
      d = chatStep("改時間", d).draft;
      d = chatStep("22:30", d).draft;
      d = chatStep("加體重", d).draft;
      d = chatStep("60", d).draft;
      expect(d?.reading).toMatchObject({
        measurement_type: "bedtime",
        weight_kg: 60,
        measured_time: "22:30",
      });
    } else if (label === "空腹") {
      d = chatStep("加血壓", d).draft;
      d = chatStep("120/80 70", d).draft;
      expect(d?.reading).toMatchObject({
        systolic: 120,
        diastolic: 80,
        pulse: 70,
      });
    } else {expect(d?.reading).toMatchObject({
        weight_kg: null,
        systolic: null,
      });}
    expect(chatStep("確認儲存", d).save?.glucose_mmol).toBe(5.6);
  }
  expect(chatStep("5.6", chatStep("餐後", null).draft).draft?.step).toBe(
    "confirm",
  );
});

it("reads pressure and pulse separated by slashes at each chat entry point", () => {
  const bloodPressure = { systolic: 120, diastolic: 80, pulse: 70 };
  const guided = { step: "pressure" as const, reading: emptyReading() };
  for (const draft of [null, chatStep("量血壓", null).draft, guided]) {
    for (const value of ["120/80/70", "１２０／８０／７０", "120/80 70"]) {
      const result = chatStep(value, draft);
      expect(result.draft?.step).toBe("confirm");
      expect(result.draft?.reading).toMatchObject(bloodPressure);
      expect(result.save).toBeUndefined();
    }
  }
  expect(chatStep("120/80", null).draft?.reading.pulse).toBeNull();
  expect(chatStep("120/80", guided).draft?.step).toBe("pulse");
  expect(
    chatStep("快速 " + today() + " 空腹 100 mg/dL 60 120/80/70", null).draft
      ?.reading,
  ).toMatchObject(bloodPressure);
  expect(() => chatStep("120/80/70/1", null)).toThrow();
});
