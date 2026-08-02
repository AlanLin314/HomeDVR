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

# 必填：主機上的絕對路徑（一鍵更新才不會掛到空的 data）
# 假設 clone 在 /root/HomeDVR：
pwd
# 把 .env 裡 HOMEDVR_HOST_PATH 改成上面 pwd 的結果
# HOMEDVR_HOST_PATH=/root/HomeDVR

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

## 從「舊版多容器」升級（清掉 repo-api-1 / repo-go2rtc-1）

舊版 Compose 會留下像 `repo-api-1`、`repo-go2rtc-1`、`repo-caddy-1` 這種**會自動重啟**的容器。  
只 `up` 新版**不會**自動刪掉它們，要手動清：

```bash
cd /root/HomeDVR   # 你的專案目錄（或實際路徑）
git pull

# 1) 停掉目前目錄的 compose，並清孤兒
docker compose down --remove-orphans

# 2) 強制刪掉舊名字（名稱可能是 repo-xxx 或 homedvr-xxx）
docker rm -f \
  repo-api-1 repo-go2rtc-1 repo-caddy-1 repo-go2rtc-init-1 \
  homedvr-api-1 homedvr-go2rtc-1 homedvr-caddy-1 \
  homedvr 2>/dev/null || true

# 3) 看還有沒有殘留
docker ps -a

# 4) 只啟動新的單一容器
docker compose up -d --build

# 5) 確認：應該只剩名為 homedvr 的一個
docker compose ps
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

或用腳本：

```bash
chmod +x scripts/cleanup-old-containers.sh
./scripts/cleanup-old-containers.sh
docker compose up -d --build
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

## 外網：已有 cloudflared 容器（推薦）

HomeDVR **不會**再起一個 cloudflared。  
它只加入既有的 **`home-net`**，讓你**現有的** cloudflared 連進來。

```text
Internet → Cloudflare → [你現有的 cloudflared]
                              │  home-net
                              ▼
                         homedvr:8080
```

### 指令

```bash
# 1) 確認 home-net + cloudflared 在上面
docker network inspect home-net --format '{{range .Containers}}{{.Name}} {{end}}'
# 若 cloudflared 不在：
# docker network connect home-net <你的cloudflared容器名>

# 2) 啟動 HomeDVR
cd /root/HomeDVR
git pull
docker compose up -d --build

# 3) 確認 homedvr 也在 home-net
docker network inspect home-net --format '{{range .Containers}}{{.Name}} {{end}}'
```

### Cloudflare Dashboard（你現有的 Tunnel）

Public Hostname → Service：

| 欄位 | 值 |
|------|-----|
| Type | HTTP |
| URL | **`homedvr:8080`** |

```text
http://homedvr:8080
```

- **不要**填 `localhost:8080`（cloudflared 在別的容器時 localhost ≠ HomeDVR）
- 再用 Access 擋未授權

### 測試

```bash
docker exec <cloudflared容器名> wget -qO- http://homedvr:8080/api/health
# 或
docker exec <cloudflared容器名> curl -s http://homedvr:8080/api/health
```

---

## 環境變數

見 [`.env.example`](.env.example)。

| 變數 | 說明 |
|------|------|
| `HOMEDVR_PORT` | 主機對外埠，預設 8080 |
| `ENABLE_WEB_UPDATE` | 網頁一鍵更新（預設 **true**；掛 docker.sock + 專案目錄） |
| `HOMEDVR_HOST_PATH` | **主機絕對路徑**（如 `/root/HomeDVR`）。一鍵更新必填，否則會起新容器且 data 是空的 |

### 一鍵更新怎麼運作

1. `homedvr` 內 `git pull`  
2. 啟動獨立容器 **`homedvr-updater`**（不會在「正在被重啟的自己」裡 recreate）  
3. updater：`docker compose build` + `up --force-recreate`  
4. 約 1～3 分鐘後重新整理網頁  

除錯：

```bash
docker logs -f homedvr-updater
docker ps -a | grep homedvr
```

手動同等操作：

```bash
cd /root/HomeDVR && git pull && docker compose up -d --build --force-recreate
```
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
