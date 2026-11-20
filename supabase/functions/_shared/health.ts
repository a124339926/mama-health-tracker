export type Kind = "fasting" | "postmeal" | "bedtime" | "other";
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
  original_data?: {
    glucose_mmol?: number | null;
    glucose_mg_reported?: number | null;
    notes?: string;
  } | null;
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
export const taipeiTime = (now = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
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
  if (
    !["fasting", "postmeal", "bedtime", "other"].includes(r.measurement_type)
  ) {
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
  const kind = {
    fasting: "空腹",
    postmeal: "餐後",
    bedtime: "睡前",
    other: "其他",
  }[r.measurement_type];
  return [
    `${r.measured_on} ${r.measured_time || "未記時間"}／${kind}`,
    r.glucose_mmol !== null &&
    `血糖 ${r.glucose_mmol} mmol/L${
      r.glucose_mg_reported !== null
        ? `（原始 ${r.glucose_mg_reported} mg/dL）`
        : ""
    }`,
    r.weight_kg !== null && `體重 ${r.weight_kg} kg`,
    r.systolic !== null && `血壓 ${r.systolic}/${r.diastolic} mmHg`,
    r.pulse !== null && `心率 ${r.pulse} 次/分`,
    r.notes,
  ].filter(Boolean).join("\n");
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
    | "quickKind"
    | "quickGlucose"
    | "quickTime"
    | "quickWeight"
    | "quickPressure"
    | "date"
    | "kind"
    | "glucose"
    | "weight"
    | "pressure"
    | "pulse"
    | "confirm";
  reading: Reading;
};
const kinds: Record<string, Kind> = {
  空腹: "fasting",
  餐後: "postmeal",
  睡前: "bedtime",
  其他: "other",
};
const homeButtons = [
  "空腹",
  "餐後",
  "睡前",
  "量體重",
  "量血壓",
  "登記",
  "表單",
];
export function buttonsFor(step?: Draft["step"]) {
  switch (step) {
    case "quickKind":
    case "kind":
      return ["空腹", "餐後", "睡前", "其他", "取消"];
    case "confirm":
      return ["確認儲存", "改時間", "加體重", "加血壓", "取消"];
    case "date":
      return ["今天", "昨天", "取消"];
    case "weight":
    case "pressure":
    case "pulse":
    case "glucose":
      return ["略過", "取消"];
    case "quickWeight":
    case "quickTime":
    case "quickPressure":
    case "quickGlucose":
      return ["取消"];
    default:
      return homeButtons;
  }
}
function quickReview(r: Reading): { draft: Draft; reply: string } {
  validateReading(r);
  return {
    draft: { step: "confirm", reading: r },
    reply: describe(r) + "\n請確認後儲存。",
  };
}
function readSugar(text: string) {
  const m = /^(\d+(?:\.\d+)?)\s*(mg\/dL|mmol\/L)?$/i.exec(text);
  if (!m) throw Error("請輸入血糖數字，例如 5.6");
  return glucose(+m[1], m[2]?.toLowerCase() === "mg/dl" ? "mg/dL" : "mmol/L");
}
const pressureHint =
  "請輸入上壓/下壓/心率，例如 120/80/70。只量血壓可輸入 120/80。";
function readPressure(text: string) {
  const match = /^(\d+)\s*\/\s*(\d+)(?:(?:\s*\/\s*|\s+)(\d+))?$/.exec(text);
  if (!match) throw Error(pressureHint);
  return {
    systolic: Number(match[1]),
    diastolic: Number(match[2]),
    ...(match[3] ? { pulse: Number(match[3]) } : {}),
  };
}
export function chatStep(
  text: string,
  draft: Draft | null,
  now = new Date(),
): { draft: Draft | null; reply: string; save?: Reading } {
  text = text.normalize("NFKC").trim();
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
      /^快速 (\d{4}-\d{2}-\d{2}) (空腹|餐後|睡前|其他) (\d+(?:\.\d+)?) (mmol\/L|mg\/dL) (\d+(?:\.\d+)?) (\d+)\s*\/\s*(\d+)(?:\s*\/\s*|\s+)(\d+)$/
        .exec(text);
    if (!m) throw Error("格式：快速 2026-11-16 空腹 100 mg/dL 60 120/80/70");
    const r = validateReading({
      ...emptyReading(),
      measured_on: m[1],
      measurement_type: ({
        空腹: "fasting",
        餐後: "postmeal",
        睡前: "bedtime",
        其他: "other",
      } as const)[
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
    const r = {
      ...emptyReading(),
      measured_on: today(now),
      measured_time: taipeiTime(now),
    };
    if (text === "量體重" || text === "量血壓") {
      r.measurement_type = "other";
      return text === "量體重"
        ? {
          draft: { step: "quickWeight", reading: r },
          reply: "體重幾公斤？請輸入數字。",
        }
        : {
          draft: { step: "quickPressure", reading: r },
          reply: pressureHint,
        };
    }
    if (kinds[text]) {
      return {
        draft: {
          step: "quickGlucose",
          reading: { ...r, measurement_type: kinds[text] },
        },
        reply: "血糖多少？直接輸入數字，例如 5.6。",
      };
    }
    if (/^\d+\s*\//.test(text)) {
      return quickReview({
        ...r,
        measurement_type: "other",
        ...readPressure(text),
      });
    }
    if (/^\d/.test(text)) {
      Object.assign(r, readSugar(text));
      validateReading(r);
      return {
        draft: { step: "quickKind", reading: r },
        reply: "這筆血糖是什麼時候量的？請點空腹、餐後或睡前。",
      };
    }
    return {
      draft: null,
      reply: "直接輸入血糖數字，或點「空腹」「餐後」「睡前」開始。",
    };
  }
  const r = { ...draft.reading };
  const skip = text === "略過";
  const number = () => {
    if (!/^\d+(\.\d+)?$/.test(text)) throw Error("請輸入數字，或回覆「略過」");
    return +text;
  };
  switch (draft.step) {
    case "quickKind":
      if (!kinds[text]) throw Error("請點選這次的測量時機。");
      r.measurement_type = kinds[text];
      return quickReview(r);
    case "quickGlucose":
      Object.assign(r, readSugar(text));
      return quickReview(r);
    case "quickTime":
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(text)) {
        throw Error("請輸入實際測量時間，例如 14:30。");
      }
      r.measured_time = text.padStart(5, "0");
      return quickReview(r);
    case "quickWeight":
      r.weight_kg = number();
      return quickReview(r);
    case "quickPressure": {
      Object.assign(r, readPressure(text));
      return quickReview(r);
    }
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
        reply: "請點選空腹、餐後、睡前或其他。",
      };
    }
    case "kind": {
      const k = ({
        空腹: "fasting",
        餐後: "postmeal",
        睡前: "bedtime",
        其他: "other",
      } as Record<
        string,
        Kind
      >)[text];
      if (!k) throw Error("請點選空腹、餐後、睡前或其他");
      r.measurement_type = k;
      return {
        draft: { step: "glucose", reading: r },
        reply: "血糖多少？直接輸入數字，例如 5.6。沒有量請點「略過」。",
      };
    }
    case "glucose": {
      if (!skip) {
        Object.assign(r, readSugar(text));
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
        reply: pressureHint + " 沒有量請點「略過」。",
      };
    case "pressure": {
      if (!skip) {
        const pressure = readPressure(text);
        Object.assign(r, pressure);
        if (pressure.pulse !== undefined) return quickReview(r);
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
      if (text === "改時間") {
        return {
          draft: { step: "quickTime", reading: r },
          reply: "請輸入實際測量時間，例如 14:30。",
        };
      }
      if (text === "加體重") {
        return {
          draft: { step: "quickWeight", reading: r },
          reply: "體重幾公斤？請輸入數字。",
        };
      }
      if (text === "加血壓") {
        return {
          draft: { step: "quickPressure", reading: r },
          reply: pressureHint,
        };
      }
      if (text !== "確認儲存") {
        throw Error("資料還沒有儲存，請回覆「確認儲存」或「取消」。");
      }
      return {
        draft: null,
        save: validateReading(r),
        reply: "已儲存",
      };
  }
}
