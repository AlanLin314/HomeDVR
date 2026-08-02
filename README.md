# HomeDVR

家用多畫面監視器牆：在同一個網頁監看所有攝影機，並可在網頁新增／管理攝影機與**區域分組**。  
外網透過 **Cloudflare Tunnel + Access** 保護；可選 **網頁一鍵更新**（git pull + 重建容器）。

## 功能

- 即時**多畫面牆**（網格、放大、全螢幕、重試）
- **網頁 CRUD** 攝影機（RTSP / NVR 來源 URL）
- **區域分組**（區域 A／B…，牆面 chips 篩選）
- **go2rtc** 轉 MSE／HLS（適合經 Cloudflare 外網觀看）
- **SQLite** 持久化（`data/`）
- **Liquid Glass** UI，手機底部導覽
- **Cloudflare Tunnel + Access** 文件與 compose profile
- **系統頁**：版本、檢查更新、一鍵更新（可關閉）

---

## Docker 安裝（建議）

### 1. 需求

| 項目 | 說明 |
|------|------|
| 主機 | 與攝影機同一區網的 NAS / PC / 伺服器 |
| 軟體 | [Docker Engine](https://docs.docker.com/engine/install/) + [Docker Compose V2](https://docs.docker.com/compose/)（`docker compose`） |
| 網路 | 主機能連到攝影機 RTSP（通常 `192.168.x.x`） |
| 磁碟 | 至少數百 MB（映像 + 設定）；錄影功能尚未內建 |

確認：

```bash
docker --version
docker compose version
```

### 2. 取得程式碼

```bash
git clone https://github.com/AlanLin314/HomeDVR.git
cd HomeDVR
```

（若你 fork 或改過 remote，把網址換成自己的。）

### 3. 環境設定

```bash
cp .env.example .env
mkdir -p data
mkdir -p data/go2rtc
```

> go2rtc 設定會寫在 **`data/go2rtc/go2rtc.yaml`**（可寫；首次由 compose 自動從範例建立）。  
> **不要**把 yaml 用 `:ro` 掛進容器，否則新增攝影機會出現 `read-only file system`。

用編輯器打開 `.env`，至少先確認：

```env
# 僅內網時可先留空
PUBLIC_BASE_URL=

# 內網建議先關掉網頁一鍵更新（不掛 docker.sock 風險較低可之後再開）
ENABLE_WEB_UPDATE=false

# 外網 Tunnel 時再填（見下方「外網」）
TUNNEL_TOKEN=
```

> `.env` 與 `data/` **不要**提交到 git（已在 `.gitignore`）。

### 4. 建置並啟動

```bash
docker compose up -d --build
```

第一次會下載映像並編譯 API／前端，可能需要數分鐘。

| 服務 | 用途 |
|------|------|
| `caddy` | 唯一入口，對外 **8080** |
| `api` | 控制 API + 網頁 |
| `go2rtc` | RTSP → 瀏覽器可播串流 |
| `cloudflared` | 僅在 `--profile tunnel` 時啟動 |

### 5. 開啟網頁

瀏覽器開啟：

```text
http://<主機IP>:8080
```

本機則是 <http://localhost:8080>。

1. 底部或頂部進 **攝影機**  
2. （可選）先新增分組，例如「區域 A」「區域 B」  
3. 新增攝影機：`rtsp://帳號:密碼@IP:554/...`  
4. 回 **畫面牆** 監看；可用頂部分組 chips 篩選  

建議畫面牆使用攝影機**副碼流（sub-stream）**，較省上行與 CPU。

### 6. 常用指令

```bash
# 查看狀態
docker compose ps

# 看 log
docker compose logs -f
docker compose logs -f api
docker compose logs -f go2rtc

# 停止
docker compose down

# 停止並刪容器（不會刪 data/ 目錄裡的資料庫）
docker compose down

# 更新程式碼後重建
git pull
docker compose up -d --build
```

或使用腳本（主機上、專案根目錄）：

```bash
chmod +x scripts/update.sh
./scripts/update.sh
```

### 7. 資料保存在哪

| 路徑 | 內容 |
|------|------|
| `./data/homedvr.db` | 攝影機、分組等設定 |
| `./.env` | 密鑰、Tunnel token 等 |
| `./go2rtc/go2rtc.yaml` | go2rtc 基礎設定（串流多半由 API 動態註冊） |

**備份**：複製整個 `data/` 與 `.env` 即可。

### 8. 埠號與防火牆

| 埠 | 說明 |
|----|------|
| **8080** | 唯一建議對外的 HTTP 入口（內網） |
| 1984 | go2rtc，**僅 compose 內部**，不要對公網開 |

路由器**不必**為了外網監看而 port forward；請用 Cloudflare Tunnel。

### 9. Windows / Docker Desktop 注意

- 使用 **WSL2 backend** 的 Docker Desktop 較穩。  
- 在 PowerShell 或 WSL 專案目錄執行 `docker compose up -d --build`。  
- 攝影機 IP 用區網位址，不要用 `localhost` 指另一台 IPC。  
- `ENABLE_WEB_UPDATE=true` 時 compose 會掛 `docker.sock`；Windows 上路徑仍為容器內 `/var/run/docker.sock`（Desktop 會轉接）。

### 10. 疑難排解

| 現象 | 可檢查 |
|------|--------|
| 打不開網頁 | `docker compose ps` 是否全 Up；本機防火牆是否擋 8080 |
| 有格但沒畫面 | 攝影機 RTSP 是否可從主機連；`docker compose logs go2rtc`；先用 VLC 測 RTSP |
| 新增後同步錯誤 | go2rtc 是否在跑；來源 URL 帳密密碼是否正確 |
| `read-only file system` / 無法 upsert | 請更新到最新 compose（config 在 `data/go2rtc`，可寫），並 **強制重建 go2rtc**：見下方指令 |
| 重建後設定不見 | 是否誤刪 `data/`；是否換了 volume 路徑 |

```bash
# 測試 API 健康
curl http://localhost:8080/api/health
```

**若仍出現 `read-only file system`（舊掛載殘留）：**

```bash
git pull
mkdir -p data/go2rtc
docker compose down
docker compose up -d --build --force-recreate
docker compose logs go2rtc-init go2rtc --tail 40
```

---

## 外網：Cloudflare Tunnel + Access

**不要**對路由器開 port；**不要**把 go2rtc 的 1984 直接暴露到公網。

### 1. 建立 Tunnel

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → Create  
2. 選擇 Docker，複製 **Tunnel token**  
3. 寫入 `.env`：

```env
TUNNEL_TOKEN=eyJ...
PUBLIC_BASE_URL=https://cameras.example.com
```

4. 啟動 tunnel profile：

```bash
docker compose --profile tunnel up -d --build
```

### 2. Public Hostname

在 Tunnel 設定中新增：

| 項目 | 值 |
|------|-----|
| Subdomain | `cameras`（自訂） |
| Domain | 你的網域 |
| Service | `http://caddy:8080` |

（cloudflared 與 caddy 在同一 compose 網路時，用服務名 `caddy`。）

### 3. Access 應用程式（擋陌生人）

1. Zero Trust → **Access** → **Applications** → Add **Self-hosted**  
2. Application domain：`cameras.example.com`（含所有 path）  
3. Policy：Action **Allow**，Include 你的 email（OTP 或 Google）  
4. **不要**設 Everyone Allow  

驗證：

- 無痕開 `https://cameras.example.com` → 應先 Access 登入  
- 未登入開 `/go2rtc/...` 或 `/api/cameras` → 應被擋  

### 4. 快取

Cache Rule：`cameras.example.com/go2rtc/*` → **Bypass cache**。

### 5. 串流協定

| 場景 | 協定 |
|------|------|
| 外網（Tunnel） | MSE（WebSocket）優先，HLS 備援 |
| 內網 | 同上 |

---

## 網頁新增攝影機與分組

| 欄位 | 說明 |
|------|------|
| 名稱 | 顯示名稱（如「大門」） |
| 來源 URL | `rtsp://...` 或 go2rtc 支援的其它 URL |
| 所屬分組 | 例如「區域 A」「區域 B」；可先在同頁建立分組 |
| 啟用 | 關閉後不出現在畫面牆 |

多畫面牆頂部 **chips**：全部／各區域／未分組。

---

## 網頁一鍵更新

設定 → **系統**：

1. **檢查更新**  
2. **一鍵更新**（僅執行 `scripts/update.sh`）  

`.env` 需：

```env
ENABLE_WEB_UPDATE=true
```

並以 compose 掛載 repo + `docker.sock`（見 `docker-compose.yml`）。

**安全**：docker.sock ≈ 主機高權限；務必用 Access 限制誰能進站。不需要時設 `ENABLE_WEB_UPDATE=false`。

手動更新：

```bash
./scripts/update.sh
```

---

## 架構

```
瀏覽器 ──HTTPS──▶ Cloudflare Access ──Tunnel──▶ Caddy
                                                ├─ /           UI
                                                ├─ /api/*      HomeDVR API
                                                └─ /go2rtc/*   go2rtc 串流
                                                     └─ RTSP 攝影機 / NVR
```

---

## 開發模式（不用完整 Docker 跑前端）

```bash
# 終端 1：go2rtc
docker run --rm -p 1984:1984 -v "${PWD}/go2rtc/go2rtc.yaml:/config/go2rtc.yaml" alexxit/go2rtc

# 終端 2：API
cd server
npm install
export DATABASE_PATH=../data/homedvr.db
export GO2RTC_URL=http://127.0.0.1:1984
export ENABLE_WEB_UPDATE=false
npm run dev

# 終端 3：前端
cd web
npm install
npm run dev
```

Vite：<http://localhost:5173>（已 proxy `/api` 與 `/go2rtc`）

---

## 環境變數

見 [`.env.example`](.env.example)。

| 變數 | 說明 |
|------|------|
| `PUBLIC_BASE_URL` | 外網 URL（文件／除錯用） |
| `GO2RTC_URL` | API 連 go2rtc 位址（compose 預設 `http://go2rtc:1984`） |
| `DATABASE_PATH` | SQLite 路徑 |
| `ENABLE_WEB_UPDATE` | 是否開網頁更新 API |
| `TUNNEL_TOKEN` | Cloudflare Tunnel token |
| `APP_VERSION` / `GIT_SHA` | 版本顯示 |

---

## 專案結構

```
HomeDVR/
├── docker-compose.yml
├── .env.example
├── caddy/Caddyfile          # 單一入口
├── go2rtc/go2rtc.yaml
├── scripts/update.sh        # 唯一允許的更新腳本
├── server/                  # Control API + 靜態 UI
├── web/                     # 前端原始碼
└── data/                    # SQLite（gitignore）
```

---

## 之後可擴充

- 錄影與回放  
- ONVIF 發現  
- 只讀／管理角色  
- Frigate 事件  

## 授權

自用／自行調整。攝影機與串流請遵守當地法規與隱私要求。
