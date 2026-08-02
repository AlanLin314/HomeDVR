# HomeDVR

家用多畫面監視器牆：一個網頁看所有攝影機，可新增／管理攝影機與**區域分組**。  
**Docker 預設只有 1 個容器**（內建 go2rtc + API + 網頁）。  
外網可選 **Cloudflare Tunnel + Access**（多 1 個 tunnel 容器）。

## 功能

- 即時**多畫面牆**（網格、放大、全螢幕）
- 網頁管理攝影機（RTSP / HTTP JPG / ffmpeg 來源）
- **區域分組**（chips 篩選）
- 內建 **go2rtc** + **ffmpeg**（含快照 JPG）
- SQLite 存在 `data/`
- Liquid Glass UI、手機底部導覽
- 可選 Cloudflare Tunnel、可選網頁一鍵更新

---

## Docker 安裝（單一容器）

### 1. 需求

- Docker + Compose V2（`docker compose`）
- 主機能連到攝影機

```bash
docker --version
docker compose version
```

### 2. 下載並啟動

```bash
git clone https://github.com/AlanLin314/HomeDVR.git
cd HomeDVR
cp .env.example .env
mkdir -p data

# 清掉舊版「多容器」殘留（若你以前跑過舊 compose）
docker compose down --remove-orphans

# 建置並啟動「一個」容器
docker compose up -d --build
```

瀏覽器開：

```text
http://<主機IP>:8080
```

本機：<http://localhost:8080>

### 3. 你應該只會看到

```bash
docker compose ps
```

| 名稱 | 說明 |
|------|------|
| **homedvr** | 唯一必要容器（網頁 + API + go2rtc） |

映像大概會多幾個 **build 用的中間層**（node、編譯），那是正常的；**常駐跑著的只需 1 個**。

清理舊映像／孤兒容器：

```bash
docker compose down --remove-orphans
docker image prune -f
```

### 4. 常用指令

```bash
docker compose ps
docker compose logs -f homedvr
docker compose restart homedvr
docker compose down
git pull && docker compose up -d --build
```

### 5. 資料在哪

| 路徑 | 內容 |
|------|------|
| `./data/homedvr.db` | 攝影機、分組 |
| `./data/go2rtc/` | go2rtc 設定（容器內自動建立） |
| `./.env` | 環境變數（勿提交 git） |

---

## 從「舊版多容器」升級

舊版有 `caddy`、`api`、`go2rtc`、`go2rtc-init` 多個服務。升級：

```bash
cd /root/HomeDVR   # 你的路徑
git pull
docker compose down --remove-orphans
docker compose up -d --build
docker compose ps   # 應只剩 homedvr
```

`data/homedvr.db` 會沿用，攝影機設定不會丟。

---

## 攝影機來源範例

| 類型 | 來源 URL 範例 |
|------|----------------|
| RTSP | `rtsp://user:pass@192.168.1.10:554/stream1` |
| 網頁 show.html | ❌ 不要用 HTML；用下面真實 JPG |
| HTTP JPG 快照 | `ffmpeg:http://192.168.88.112/cgi-bin/web_jpg.cgi?ch=0#video=h264` |
| MJPEG | `http://192.168.x.x/video.mjpg` |

---

## 外網（可選第二個容器）

不開路由器 port。需要時才啟動 tunnel：

```bash
# .env 填 TUNNEL_TOKEN=...
docker compose --profile tunnel up -d
```

此時會多一個 **homedvr-tunnel**。  
Access / Public Hostname 請指向 `http://homedvr:8080`（若 tunnel 與 homedvr 在同一 compose 網路；單一服務名為 `homedvr`）。

更簡單：在 Cloudflare Dashboard 把 Tunnel 的 Public Hostname service 設成：

```text
http://localhost:8080
```

並讓 cloudflared 與 HomeDVR **跑在同一台主機**（host 網路或指到主機 IP:8080）。

---

## 環境變數

見 [`.env.example`](.env.example)。

| 變數 | 說明 |
|------|------|
| `HOMEDVR_PORT` | 主機對外埠，預設 8080 |
| `ENABLE_WEB_UPDATE` | 網頁一鍵更新（預設 false；需自行掛 docker.sock） |
| `TUNNEL_TOKEN` | 僅 tunnel profile |
| `PUBLIC_BASE_URL` | 外網網址（文件用） |

---

## 架構（單容器）

```
瀏覽器 → :8080 → HomeDVR 容器
                   ├─ 網頁 UI
                   ├─ /api/*     控制 API + SQLite
                   └─ /go2rtc/*  反代到本機 go2rtc → 攝影機
```

---

## 開發模式（本機，不用 Docker 全包）

```bash
# go2rtc 需自行安裝或 docker 只跑 go2rtc
cd server && npm install && npm run dev
cd web && npm install && npm run dev
```

---

## 授權

自用／自行調整。請遵守當地監看與隱私法規。
