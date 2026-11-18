import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, configured, initLine, loginLine, logoutLine } from "./api";
import { Chart } from "./Chart";
import { Entry } from "./Entry";
import { excel } from "./export";
import {
  emptyReading,
  type Reading,
  today,
} from "../supabase/functions/_shared/health";
import "./style.css";
type Data = {
  patient: { id: string; display_name: string };
  readings: Reading[];
  role: string;
  members: { line_user_id: string; role: string }[];
  links: {
    line_user_id: string;
    reminders_enabled: boolean;
    daily_hour: number;
    missed_hour: number;
  }[];
};
const fmt = (n: number | null | undefined) => n == null ? "—" : String(n);
function App() {
  const [ready, setReady] = useState(false),
    [logged, setLogged] = useState(false),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [tab, setTab] = useState("glucose"),
    [entry, setEntry] = useState<Reading | null>(null),
    [code, setCode] = useState(""),
    [role, setRole] = useState("viewer");
  const load = async () => {
    try {
      const d = await api("load");
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const line = await initLine();
        if (!active) return;
        setLogged(line);
        if (line) await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (active) setReady(true);
      }
    })();
    const expired = () => {
      setLogged(false);
      setData(null);
      setEntry(null);
    };
    window.addEventListener("line-session-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("line-session-expired", expired);
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows = data?.readings.filter((r) => r.measured_on.startsWith(month)) ||
      [],
    fast = rows.filter((r) =>
      r.measurement_type === "fasting" && r.glucose_mmol !== null
    ),
    lastWeight = [...rows].reverse().find((r) => r.weight_kg !== null);
  const changeMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(
      new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7),
    );
  };
  const moveTo = (id: string) => {
    document.getElementById(id)?.focus();
    location.hash = id;
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">♥</div>
        <div className="brand-text">
          媽媽的健康日記<span>安心記錄每一天</span>
        </div>
        {logged && (
          <button
            className="small-link top-actions"
            onClick={() =>
              void act(async () => {
                await logoutLine();
                setData(null);
                setLogged(false);
                location.href = location.pathname;
              })}
          >
            登出
          </button>
        )}
      </header>
      <main className="main-layout">
        <section className="hero">
          <div className="hero-text">
            <span className="eyebrow">HOME HEALTH JOURNAL</span>
            <h1>
              每天量一點，<br />變化看得見。
            </h1>
            <p>記下空腹或餐後血糖、體重和血壓，輕鬆回顧每個月的健康變化。</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="round-decor" style={{ fontSize: 75 }}>♡</div>
          </div>
        </section>
        {error && <p role="alert" className="notice error">{error}</p>}
        {notice && <p role="status" className="notice ok">{notice}</p>}
        {!configured
          ? (
            <section className="panel">
              <h2>網站設定中</h2>
              <p>資料庫尚未連接，暫時無法登入或儲存健康資料。</p>
            </section>
          )
          : !ready
          ? <p className="notice" role="status">正在確認登入…</p>
          : !logged
          ? (
            <section className="auth-panel">
              <h2>用 LINE 開啟健康日記</h2>
              <p>
                使用自己的 LINE
                登入，輕鬆記錄與查看。家屬首次加入時，再輸入管理者提供的邀請碼。
              </p>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void act(loginLine)}
              >
                使用 LINE 登入
              </button>
            </section>
          )
          : !data
          ? (
            <section className="panel">
              <h2>開始使用健康日記</h2>
              <p>首次使用可建立日記。家屬請輸入管理者提供的邀請碼。</p>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api("create");
                    await load();
                  })}
              >
                建立媽媽的日記
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get("code"),
                  );
                  void act(async () => {
                    await api("join", { code: value.trim() });
                    await load();
                  });
                }}
              >
                <label>
                  家屬邀請碼<input name="code" required autoComplete="off" />
                </label>
                <button className="btn secondary" disabled={busy}>
                  加入既有日記
                </button>
              </form>
            </section>
          )
          : (
            <>
              <nav className="home-actions" aria-label="主要功能">
                <button
                  className="btn primary"
                  disabled={data.role === "viewer"}
                  onClick={() => setEntry(emptyReading())}
                >
                  新增紀錄
                </button>
                <button
                  className="btn secondary"
                  onClick={() => moveTo("trends")}
                >
                  查看曲線
                </button>
                <button
                  className="btn secondary"
                  onClick={() => moveTo("history")}
                >
                  歷史紀錄
                </button>
              </nav>
              <div className="section-heading">
                <h2>每月健康概況</h2>
                <div className="month-switch">
                  <button aria-label="上個月" onClick={() => changeMonth(-1)}>
                    ‹
                  </button>
                  <strong>{month.replace("-", " 年 ")} 月</strong>
                  <button aria-label="下個月" onClick={() => changeMonth(1)}>
                    ›
                  </button>
                </div>
              </div>
              <div className="stats-grid">
                {[
                  ["最新空腹血糖", fmt(fast.at(-1)?.glucose_mmol), "mmol/L"],
                  [
                    "空腹血糖月平均",
                    fast.length
                      ? (fast.reduce((s, r) => s + r.glucose_mmol!, 0) /
                        fast.length).toFixed(2)
                      : "—",
                    "mmol/L",
                  ],
                  ["最近體重", fmt(lastWeight?.weight_kg), "kg"],
                  ["本月紀錄", String(rows.length), "筆"],
                ].map(([label, value, unit]) => (
                  <div className="stat" key={label}>
                    <div className="stat-label">{label}</div>
                    <div className="stat-value">{value}</div>
                    <div className="stat-note">{unit}</div>
                  </div>
                ))}
              </div>
              <section className="panel trend-panel" id="trends" tabIndex={-1}>
                <div className="panel-title">
                  <h2>健康變化曲線</h2>
                  <div className="tab-list" aria-label="曲線項目">
                    {[["glucose", "血糖"], ["weight", "體重"], [
                      "pressure",
                      "血壓",
                    ], ["pulse", "心率"]].map(([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={tab === key}
                        className={tab === key ? "active" : ""}
                        onClick={() => setTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="chart-root">
                  <Chart rows={rows} tab={tab} month={month} />
                </div>
                <p className="panel-footnote">
                  曲線呈現紀錄趨勢，不提供診斷。原始註記保留於歷史紀錄與匯出檔。
                </p>
              </section>
              <section className="panel" id="history" tabIndex={-1}>
                <div className="panel-title">
                  <h2>歷史紀錄</h2>
                  <button
                    className="btn secondary"
                    disabled={busy || !rows.length}
                    onClick={() =>
                      void act(async () => {
                        await excel(rows, month);
                        setNotice("已匯出本月份 Excel，請妥善保存。");
                      })}
                  >
                    匯出 Excel
                  </button>
                </div>
                <div className="calendar" aria-label={`${month}月曆`}>
                  {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                    <strong key={d}>{d}</strong>
                  ))}
                  {Array.from({
                    length: new Date(month + "-01T00:00:00").getDay(),
                  }, (_, i) => <span key={"blank" + i} />)}
                  {Array.from({
                    length: new Date(+month.slice(0, 4), +month.slice(5), 0)
                      .getDate(),
                  }, (_, i) => {
                    const date = month + "-" + String(i + 1).padStart(2, "0"),
                      count = rows.filter((r) => r.measured_on === date).length;
                    return (
                      <button
                        key={date}
                        disabled={date > today()}
                        aria-label={`${date}，${count}筆紀錄，${
                          count ? "查看" : "補登"
                        }`}
                        className={count ? "has-record" : ""}
                        onClick={() => {
                          if (count) {
                            setNotice(
                              `${date} 有 ${count} 筆，請在下方紀錄查看。`,
                            );
                            document.getElementById("day-" + date)?.focus();
                          } else if (data.role !== "viewer") {
                            setEntry({ ...emptyReading(), measured_on: date });
                          }
                        }}
                      >
                        {i + 1}
                        {count > 0 && <small>{count}筆</small>}
                      </button>
                    );
                  })}
                </div>
                <div className="record-list">
                  {[...rows].reverse().map((r, index, descending) => (
                    <article
                      className="reading-card"
                      key={r.id}
                      id={descending[index - 1]?.measured_on === r.measured_on
                        ? undefined
                        : "day-" + r.measured_on}
                      tabIndex={-1}
                    >
                      <div className="reading-head">
                        <strong>
                          {r.measured_on}{" "}
                          {r.measured_time?.slice(0, 5) || "未記時間"}
                        </strong>
                        <span className={"type-tag " + r.measurement_type}>
                          {{
                            fasting: "空腹",
                            postmeal: "餐後",
                            bedtime: "睡前",
                            other: "其他",
                          }[r.measurement_type]}
                        </span>
                      </div>
                      <p>
                        血糖 {fmt(r.glucose_mmol)} mmol/L　體重{" "}
                        {fmt(r.weight_kg)} kg
                      </p>
                      <p>
                        血壓 {fmt(r.systolic)}/{fmt(r.diastolic)} mmHg　心率
                        {" "}
                        {fmt(r.pulse)} 次／分
                      </p>
                      {r.glucose_mg_reported !== null && (
                        <p>原始血糖：{r.glucose_mg_reported} mg/dL</p>
                      )}
                      {r.notes && <p className="original-note">{r.notes}</p>}
                      {r.original_data &&
                        (r.original_data.glucose_mmol !== r.glucose_mmol ||
                          r.original_data.glucose_mg_reported !==
                            r.glucose_mg_reported ||
                          r.original_data.notes !== r.notes) &&
                        (
                          <div className="original-note">
                            <p>
                              首次原始血糖：{fmt(r.original_data.glucose_mmol)}
                              {" "}
                              mmol/L／{fmt(r.original_data.glucose_mg_reported)}
                              {" "}
                              mg/dL
                            </p>
                            <p>
                              首次原始註記：{r.original_data.notes || "未填寫"}
                            </p>
                          </div>
                        )}
                      {data.role !== "viewer" && (
                        <button
                          className="btn secondary"
                          onClick={() => setEntry(r)}
                        >
                          修改這筆紀錄
                        </button>
                      )}
                    </article>
                  ))}
                  {!rows.length && (
                    <p className="empty-chart">
                      本月還沒有紀錄，可按「新增紀錄」或月曆補登。
                    </p>
                  )}
                </div>
              </section>
              {data.role === "owner" && (
                <section className="panel">
                  <h2>家屬與 LINE 設定</h2>
                  <p>
                    邀請碼 15 分鐘內有效，僅限使用一次。請私下交給信任的家屬。
                  </p>
                  <label>
                    授權種類<select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="viewer">家屬：只能查看與匯出</option>
                      <option value="editor">家屬：可新增與修改</option>
                      <option value="line">綁定媽媽的 LINE</option>
                    </select>
                  </label>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        setCode((await api("invite", { role })).code);
                      })}
                  >
                    產生一次性代碼
                  </button>
                  {code && (
                    <p className="invite-code">
                      {role === "line"
                        ? "請在 LINE 輸入「綁定 " + code + "」"
                        : code}
                    </p>
                  )}
                  {data.members.map((m) => (
                    <p key={m.line_user_id}>
                      LINE 帳號 …{m.line_user_id.slice(-6)}：{{
                        owner: "管理者",
                        editor: "可編輯",
                        viewer: "只能查看",
                      }[m.role]} {m.role !== "owner" && (
                        <button
                          className="btn secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api("revoke", { lineId: m.line_user_id });
                              await load();
                            })}
                        >
                          撤銷權限
                        </button>
                      )}
                    </p>
                  ))}
                  {data.links.map((link) => (
                    <form
                      key={link.line_user_id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void act(async () => {
                          await api("reminders", {
                            lineId: link.line_user_id,
                            enabled: f.get("enabled") === "on",
                            daily: Number(f.get("daily")),
                            missed: Number(f.get("missed")),
                          });
                          await load();
                          setNotice("提醒偏好已儲存；排程服務啟用後生效。");
                        });
                      }}
                    >
                      <h3>LINE {link.line_user_id.slice(-4)}</h3>
                      <label>
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={link.reminders_enabled}
                        />開啟提醒
                      </label>
                      <div className="form-grid">
                        <label>
                          每日提醒（台北時間）<input
                            name="daily"
                            type="number"
                            min="0"
                            max="23"
                            defaultValue={link.daily_hour}
                          />
                        </label>
                        <label>
                          漏登提醒（台北時間）<input
                            name="missed"
                            type="number"
                            min="0"
                            max="23"
                            defaultValue={link.missed_hour}
                          />
                        </label>
                      </div>
                      <button className="btn primary" disabled={busy}>
                        儲存提醒設定
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api("unlink", { lineId: link.line_user_id });
                            await load();
                          })}
                      >
                        停用聊天室與提醒
                      </button>
                    </form>
                  ))}
                </section>
              )}
            </>
          )}
      </main>
      <footer>
        健康紀錄僅供本人與已授權家屬使用<br />
        <a href="privacy.html">隱私權說明</a>
        <a href="terms.html">使用說明</a>
      </footer>
      {entry && (
        <Entry
          initial={entry}
          onClose={() => setEntry(null)}
          onSave={async (reading, requestId) => {
            await api("save", { reading, requestId });
            setMonth(reading.measured_on.slice(0, 7));
            await load();
            setNotice("紀錄已儲存。");
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
