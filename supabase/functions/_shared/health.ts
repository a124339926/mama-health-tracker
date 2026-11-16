export type Kind = "fasting" | "postmeal" | "other";
export type Reading = {
  id?: string;
  patient_id?: string;
  measured_on: string;
  measured_time: string | null;
  measurement_type: Kind;
  glucose_mmol: number | null;
  glucose_mg_reported: number | null;
  weight_kg: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  notes: string;
  source?: string;
  source_key?: string | null;
};
export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function validateReading(value: unknown): Reading {
  if (!value || typeof value !== "object") throw Error("請填寫測量資料");
  const r = value as Reading;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(r.measured_on) ||
    new Date(r.measured_on + "T00:00:00Z").toISOString().slice(0, 10) !==
      r.measured_on ||
    r.measured_on > today()
  ) throw Error("日期不正確，不能登記未來日期");
  if (
    r.measured_time &&
    !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(r.measured_time)
  ) throw Error("請確認測量時間");
  if (!["fasting", "postmeal", "other"].includes(r.measurement_type)) {
    throw Error("請選擇空腹或餐後");
  }
  const limits = {
    glucose_mmol: [0.5, 35],
    glucose_mg_reported: [9, 630],
    weight_kg: [1, 400],
    systolic: [30, 300],
    diastolic: [20, 200],
    pulse: [20, 250],
  };
  for (const [key, [lo, hi]] of Object.entries(limits)) {
    const n = r[key as keyof typeof limits];
    if (
      n !== null &&
      (typeof n !== "number" || !Number.isFinite(n) || n < lo || n > hi)
    ) throw Error("請確認數值與單位，超出可輸入範圍");
  }
  if (
    [r.glucose_mmol, r.weight_kg, r.systolic, r.pulse].every((n) => n === null)
  ) throw Error("至少填寫一項數據");
  if (
    (r.systolic === null) !== (r.diastolic === null) ||
    (r.systolic !== null && r.diastolic !== null && r.systolic <= r.diastolic)
  ) throw Error("血壓請成對填寫，收縮壓應大於舒張壓");
  if (
    [r.systolic, r.diastolic, r.pulse].some((n) =>
      n !== null && !Number.isInteger(n)
    )
  ) throw Error("血壓與心率請填整數");
  if (typeof r.notes !== "string" || r.notes.length > 2000) {
    throw Error("備註請在 2000 字內");
  }
  return r;
}
export function glucose(input: number, unit: string) {
  if (!Number.isFinite(input) || !["mmol/L", "mg/dL"].includes(unit)) {
    throw Error("血糖格式不正確");
  }
  return {
    glucose_mmol: Math.round((unit === "mg/dL" ? input / 18 : input) * 100) /
      100,
    glucose_mg_reported: unit === "mg/dL" ? input : null,
  };
}
export const emptyReading = (): Reading => ({
  measured_on: today(),
  measured_time: null,
  measurement_type: "fasting",
  glucose_mmol: null,
  glucose_mg_reported: null,
  weight_kg: null,
  systolic: null,
  diastolic: null,
  pulse: null,
  notes: "",
});
export function describe(r: Reading) {
  return `${r.measured_on} ${r.measured_time || "未記時間"}／${
    { fasting: "空腹", postmeal: "餐後", other: "其他" }[r.measurement_type]
  }\n血糖 ${r.glucose_mmol ?? "—"} mmol/L${
    r.glucose_mg_reported !== null
      ? `（原始 ${r.glucose_mg_reported} mg/dL）`
      : ""
  }\n體重 ${r.weight_kg ?? "—"} kg\n血壓 ${r.systolic ?? "—"}/${
    r.diastolic ?? "—"
  } mmHg\n心率 ${r.pulse ?? "—"} 次/分\n${r.notes}`.trim();
}
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifySignature(
  raw: string,
  signature: string,
  secret: string,
) {
  if (!signature || !secret) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(raw),
    );
  } catch {
    return false;
  }
}
export type Draft = {
  step:
    | "date"
    | "kind"
    | "glucose"
    | "weight"
    | "pressure"
    | "pulse"
    | "confirm";
  reading: Reading;
};
export function chatStep(
  text: string,
  draft: Draft | null,
): { draft: Draft | null; reply: string; save?: Reading } {
  text = text.trim();
  if (text === "取消") {
    return {
      draft: null,
      reply: "已取消，本次沒有儲存。輸入「登記」可重新開始。",
    };
  }
  if (text === "登記" || text === "新增紀錄") {
    return {
      draft: { step: "date", reading: emptyReading() },
      reply: "請回覆測量日期：今天、昨天，或 YYYY-MM-DD。",
    };
  }
  if (text.startsWith("快速 ")) {
    const m =
      /^快速 (\d{4}-\d{2}-\d{2}) (空腹|餐後|其他) (\d+(?:\.\d+)?) (mmol\/L|mg\/dL) (\d+(?:\.\d+)?) (\d+)\/(\d+) (\d+)$/
        .exec(text);
    if (!m) throw Error("格式：快速 2026-11-16 空腹 100 mg/dL 60 120/80 70");
    const r = validateReading({
      ...emptyReading(),
      measured_on: m[1],
      measurement_type:
        ({ 空腹: "fasting", 餐後: "postmeal", 其他: "other" } as const)[
          m[2] as "空腹"
        ],
      ...glucose(+m[3], m[4]),
      weight_kg: +m[5],
      systolic: +m[6],
      diastolic: +m[7],
      pulse: +m[8],
    });
    return {
      draft: { step: "confirm", reading: r },
      reply: describe(r) + "\n請回覆「確認儲存」或「取消」。",
    };
  }
  if (!draft) {
    return {
      draft: null,
      reply:
        "輸入「登記」逐項填寫；也可用「快速 日期 空腹 100 mg/dL 60 120/80 70」。未綁定請先在網頁產生代碼，再輸入「綁定 代碼」。",
    };
  }
  const r = { ...draft.reading };
  const skip = text === "略過";
  const number = () => {
    if (!/^\d+(\.\d+)?$/.test(text)) throw Error("請輸入數字，或回覆「略過」");
    return +text;
  };
  switch (draft.step) {
    case "date": {
      const yesterday = new Date(today() + "T00:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      r.measured_on = text === "今天"
        ? today()
        : text === "昨天"
        ? yesterday.toISOString().slice(0, 10)
        : text;
      validateReading({ ...r, weight_kg: 60 });
      return {
        draft: { step: "kind", reading: r },
        reply: "這次是「空腹」、「餐後」還是「其他」？",
      };
    }
    case "kind": {
      const k = ({ 空腹: "fasting", 餐後: "postmeal", 其他: "other" } as Record<
        string,
        Kind
      >)[text];
      if (!k) throw Error("請回覆空腹、餐後或其他");
      r.measurement_type = k;
      return {
        draft: { step: "glucose", reading: r },
        reply:
          "請輸入血糖與單位，例如「100 mg/dL」或「5.6 mmol/L」，沒有量請回覆「略過」。",
      };
    }
    case "glucose": {
      if (!skip) {
        const m = /^(\d+(?:\.\d+)?)\s*(mg\/dL|mmol\/L)$/.exec(text);
        if (!m) throw Error("請同時輸入血糖與單位，例如 100 mg/dL");
        Object.assign(r, glucose(+m[1], m[2]));
        validateReading(r);
      }
      return {
        draft: { step: "weight", reading: r },
        reply: "體重幾公斤？請輸入數字，或「略過」。",
      };
    }
    case "weight":
      if (!skip) {
        r.weight_kg = number();
        validateReading(r);
      }
      return {
        draft: { step: "pressure", reading: r },
        reply: "血壓多少？例如「120/80」，或「略過」。",
      };
    case "pressure": {
      if (!skip) {
        const m = /^(\d+)\/(\d+)$/.exec(text);
        if (!m) throw Error("請用 120/80 格式填血壓");
        r.systolic = +m[1];
        r.diastolic = +m[2];
        validateReading(r);
      }
      return {
        draft: { step: "pulse", reading: r },
        reply: "心率每分鐘幾次？請輸入數字，或「略過」。",
      };
    }
    case "pulse":
      if (!skip) r.pulse = number();
      validateReading(r);
      return {
        draft: { step: "confirm", reading: r },
        reply: describe(r) + "\n請回覆「確認儲存」或「取消」。",
      };
    case "confirm":
      if (text !== "確認儲存") {
        throw Error("資料還沒有儲存，請回覆「確認儲存」或「取消」。");
      }
      return {
        draft: null,
        save: validateReading(r),
        reply: "已儲存，可以在網頁查看紀錄。",
      };
  }
}
