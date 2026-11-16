# 媽媽的健康日記

延續已下載的 HTML 預覽，保留奶油白與鼠尾草綠設計，轉成 React／TypeScript。原開發 ZIP 連結無法使用，後端與測試在使用者同意後補齊。

## 本機

Node 24、pnpm 11.25.0。`pnpm install --frozen-lockfile`，複製 `.env.example` 為 `.env.local` 填公開設定，執行 `pnpm dev`。`pnpm test` 驗證共用輸入、聊天室狀態、Webhook 簽章及本機 PostgreSQL RLS；`pnpm build` 建置正式網站。

## 獨立 Supabase

限定 Mama Health 組織、獨立專案、東京 ap-northeast-1、Free。不可連結或部署至 whisper-time。專案建立後，檢查 CLI `--help`，以明確的 Mama Health 專案 ref 部署遷移與三個 Edge Functions。不得以其他既有專案替代。部署前確認遠端 ref、組織與方案。

`supabase/migrations` 建立日記、家屬角色、測量紀錄、一次性邀請碼、LINE 綁定、聊天草稿與提醒去重表。所有表啟用 RLS。viewer 只能讀；editor 可新增及修改；owner 可管理成員。敏感 LINE 身分與邀請碼表不授權一般客戶端讀取。服務端 API 每次重新檢查家屬角色。LIFF 必須由 LINE 官方 API 驗證 ID token，不信任前端傳來的 user ID。

在 Supabase Edge Function secrets 設定：`APP_ORIGIN`、`LINE_LOGIN_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LIFF_ID`、`REMINDER_SECRET`。`SUPABASE_URL` 及 `SUPABASE_SERVICE_ROLE_KEY` 使用平台內建環境變數。密鑰不進 VITE、不進 GitHub、不貼聊天。APP_ORIGIN 是正式網址的 origin，不含路徑。

Auth 設定 Site URL 與 Redirect URLs 指向正式網站完整路徑。家屬先以 Email 登入，建立日記，產生 15 分鐘單次 viewer/editor 邀請碼；其他家屬登入後貼碼加入。owner 可撤銷家屬及 LINE 綁定。初次匯入前必須建立日記，取得真正的 patient UUID。

## LINE

在同一個 Provider 建立 Messaging API 與 LINE Login Channel。開啟 LIFF 的 `openid` scope，Endpoint URL 為正式網站 `?liff=1`，填入 LIFF ID。Messaging API Webhook URL 為 `https://<Mama project ref>.supabase.co/functions/v1/line-webhook`，開啟 Webhook 與重送、關閉會干擾互動的預設自動回覆。

由網頁管理者產生 LINE 綁定碼，媽媽在一對一聊天室輸入「綁定 代碼」。不在群組或多人聊天室回覆健康資料。輸入「登記」逐項填日期、空腹／餐後、血糖與單位、體重、血壓、心率；每次最後必須回覆「確認儲存」。回覆「表單」開啟 LIFF。快速格式：`快速 YYYY-MM-DD 空腹 100 mg/dL 60 120/80 70`（說明數值為合成範例）。草稿 30 分鐘未使用會失效。

提醒預設關閉，管理者可在網頁開啟並設定台北時間。排程每 10 分鐘 POST 到 `reminders`，Authorization 使用 `Bearer <REMINDER_SECRET>`。可用 Supabase Cron + Vault 安全保存密鑰；不可將密鑰直接寫入 SQL、GitHub 工作流程或公開網址。排程只在設定的小時發送，當日已有任一紀錄則跳過漏登提醒，資料庫唯一鍵與 LINE retry key 防止重複推播。推播不包含測量數值。失敗重試限該小時內，超過時段不補發，需在維運紀錄檢查 failed。LINE 免費訊息額度需由官方帳號後台確認，任何付費升級先取得使用者同意。

## 私人歷史匯入

CSV 原檔保存在 Downloads 或其他私人目錄，不得放進本專案。原始雙單位、空白測量時間、來源識別碼與註記全部保留，不以換算值覆蓋原始 mg/dL。

`python3 scripts/import_history.py --csv /私人絕對路徑.csv --patient <UUID>` 預設只檢查。正式匯入需在本機環境設定 `MAMA_PROJECT_REF`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 再加 `--commit`。URL 必須符合指定獨立 ref，工具拒絕 whisper-time，先確認 patient 存在才傳送健康資料。以 patient_id/source_key 去重，重跑不覆寫舊紀錄。

## GitHub Pages

只提交程式、遷移與合成測試；不得提交 CSV、Excel、密鑰、真實健康數據或含數據的截圖。`.gitignore` 提供額外防護，提交前仍需逐檔檢查。設定 Pages Source 為 GitHub Actions。Repository variables 僅填公開的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_LIFF_ID`。`.github/workflows/pages.yml` 先測試與建置，再部署 `dist`。沒有資料庫設定時只顯示設定中，不接受健康資料。

## 上線驗收

先用合成資料驗證兩個家屬帳戶的 RLS 隔離、viewer 禁止修改、撤銷立即生效、登入回跳、手機日期補登、修改保留原始註記、真正 XLSX 匯出。LINE 先驗空事件簽章，再逐項及快速填寫，確認前不寫入、確認後只新增一筆；重送同一事件不重複新增。驗證 LIFF 顯示相同日記，提醒與漏登提醒各實際收一則。完成後再匯入私人歷史，核對筆數及原始註記。未完成的遠端驗證不得描述為已通過。
