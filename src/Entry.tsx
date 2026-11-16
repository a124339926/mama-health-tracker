import { useEffect, useRef, useState } from "react";
import {
  describe,
  glucose,
  type Reading,
  today,
  validateReading,
} from "../supabase/functions/_shared/health";
export function Entry(
  { initial, onClose, onSave }: {
    initial: Reading;
    onClose: () => void;
    onSave: (r: Reading, requestId: string) => Promise<void>;
  },
) {
  const requestId = useRef(crypto.randomUUID());
  const [working, setWorking] = useState(initial);
  const ref = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<Reading | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="entry-title"
    >
      <div className="entry-form">
        <div className="form-head">
          <div>
            <h2 id="entry-title">
              {review ? "請確認資料" : initial.id ? "修改紀錄" : "新增紀錄"}
            </h2>
            <p>可以補登日期。未測量的項目請留白。</p>
          </div>
          <button
            className="plain"
            onClick={onClose}
            disabled={busy}
            aria-label="關閉表單"
          >
            ×
          </button>
        </div>
        {review
          ? (
            <>
              <pre className="review">{describe(review)}</pre>
              <div className="form-actions">
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  返回修改
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await onSave(review, requestId.current);
                      onClose();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "儲存中…" : "確認儲存"}
                </button>
              </div>
            </>
          )
          : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                try {
                  const f = new FormData(e.currentTarget);
                  const num = (k: string) =>
                    f.get(k) === "" ? null : Number(f.get(k));
                  const g = num("glucose");
                  const value = {
                    ...initial,
                    measured_on: String(f.get("measured_on")),
                    measured_time: String(f.get("measured_time")) || null,
                    measurement_type: String(
                      f.get("measurement_type"),
                    ) as Reading["measurement_type"],
                    ...(g === null
                      ? { glucose_mmol: null, glucose_mg_reported: null }
                      : glucose(g, String(f.get("unit")))),
                    weight_kg: num("weight_kg"),
                    systolic: num("systolic"),
                    diastolic: num("diastolic"),
                    pulse: num("pulse"),
                    notes: String(f.get("notes")),
                  };
                  // Keep the original dual-unit reading unless the glucose itself was edited.
                  if (
                    g === working.glucose_mmol && f.get("unit") === "mmol/L"
                  ) value.glucose_mg_reported = working.glucose_mg_reported;
                  setWorking(value);
                  setReview(validateReading(value));
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <div className="form-grid">
                <label>
                  測量日期<input
                    name="measured_on"
                    type="date"
                    required
                    max={today()}
                    defaultValue={working.measured_on}
                  />
                </label>
                <label>
                  測量時間（可留白）<input
                    name="measured_time"
                    type="time"
                    defaultValue={working.measured_time?.slice(0, 5) || ""}
                  />
                </label>
              </div>
              <label>
                血糖測量時機<select
                  name="measurement_type"
                  defaultValue={working.measurement_type}
                >
                  <option value="fasting">空腹</option>
                  <option value="postmeal">餐後</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <div className="form-grid">
                <label>
                  血糖<input
                    name="glucose"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    defaultValue={working.glucose_mmol ?? ""}
                  />
                </label>
                <label>
                  血糖單位<select name="unit" defaultValue="mmol/L">
                    <option>mmol/L</option>
                    <option>mg/dL</option>
                  </select>
                </label>
              </div>
              <label>
                體重（公斤）<input
                  name="weight_kg"
                  type="number"
                  min="1"
                  max="400"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={working.weight_kg ?? ""}
                />
              </label>
              <div className="form-grid">
                <label>
                  收縮壓（上壓）<input
                    name="systolic"
                    type="number"
                    step="1"
                    inputMode="numeric"
                    defaultValue={working.systolic ?? ""}
                  />
                </label>
                <label>
                  舒張壓（下壓）<input
                    name="diastolic"
                    type="number"
                    step="1"
                    inputMode="numeric"
                    defaultValue={working.diastolic ?? ""}
                  />
                </label>
              </div>
              <label>
                心率（次／分）<input
                  name="pulse"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  defaultValue={working.pulse ?? ""}
                />
              </label>
              <label>
                原始註記／備註<textarea
                  name="notes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={working.notes}
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={onClose}
                >
                  取消
                </button>
                <button className="btn primary">下一步：確認資料</button>
              </div>
            </form>
          )}
        {error && <p className="notice error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
}
