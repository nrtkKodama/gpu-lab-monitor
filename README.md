# GPU Lab Monitor

研究室のGPUサーバー群を一元管理する監視ダッシュボードです。
各サーバーのGPU使用率、温度、電力、そして**現在誰が（どのDockerコンテナが）GPUを使用しているか**を可視化します。

SSHログインやパスワード管理は不要。IPアドレスを登録するだけで、Webブラウザからクラスタ全体の状況を把握できます。

---

## 🛠 前提条件

**管理者PC (フロントエンド表示用)**
- Node.js (v16以上推奨)
- Git

**監視対象GPUサーバー (バックエンドエージェント用)**
- Linux (Ubuntu等)
- NVIDIA Driver & nvidia-smi
- Python 3.x
- Docker (コンテナ情報の取得に必要)

---

## 🚀 セットアップ手順

### Step 1: リポジトリのクローン (管理者PC)

まず、ソースコードをローカル環境にダウンロードします。

```bash
# プロジェクトをクローン
git clone https://github.com/your-username/gpu-lab-monitor.git

# ディレクトリに移動
cd gpu-lab-monitor
```

---

### Step 2: 監視エージェントの構築 (GPUサーバー側)

**※この作業は、監視したい全てのGPUサーバーで行ってください。**

各サーバー上で「自分のステータスをJSONで返す」小さなWebサーバー（エージェント）を立ち上げます。

#### 1. 必要なPythonライブラリのインストール
```bash
sudo apt update
sudo apt install -y python3-pip
pip3 install fastapi uvicorn
```

#### 2. エージェントスクリプトの作成
適当な場所（例: `/opt/gpu-monitor`）を作成し、以下のスクリプトを `monitor.py` として保存します。
**このスクリプトは nvidia-smi が「N/A」を返した場合でもクラッシュしないように対策されています。**

**ファイル: `/opt/gpu-monitor/monitor.py`**

```python
import subprocess
import csv
import io
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS設定: ブラウザからの直接アクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def safe_int(val):
    """'40 MiB', '[N/A]', 'Error' などを安全にintに変換"""
    try:
        # "40 MiB" -> "40"
        cleaned = str(val).split()[0].strip()
        return int(float(cleaned))
    except:
        return 0

def safe_float(val):
    """'45.5 W' などを安全にfloatに変換"""
    try:
        cleaned = str(val).split()[0].strip()
        return float(cleaned)
    except:
        return 0.0

def get_docker_map():
    """実行中のDockerコンテナのPIDとメタデータをマッピング"""
    docker_map = {}
    try:
        cmd = ["docker", "ps", "-q"]
        container_ids = subprocess.check_output(cmd).decode().split()
        if not container_ids: return {}

        inspect_cmd = ["docker", "inspect", "--format", "{{.State.Pid}},{{.Name}},{{.Config.User}},{{.Config.Image}}"] + container_ids
        output = subprocess.check_output(inspect_cmd).decode()
        
        for line in output.splitlines():
            if not line.strip(): continue
            parts = line.split(',')
            if len(parts) >= 4:
                pid = safe_int(parts[0])
                name = parts[1].strip().lstrip('/')
                user = parts[2].strip() or "root"
                image = parts[3].strip()
                docker_map[pid] = {"containerName": name, "user": user, "image": image}
    except Exception as e:
        print(f"Docker info fetch error: {e}")
    return docker_map

def get_gpu_processes():
    """nvidia-smiからプロセス情報を取得し、Docker情報と結合"""
    processes = []
    docker_map = get_docker_map()

    try:
        cmd = ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]
        output = subprocess.check_output(cmd).decode()
        
        for line in output.splitlines():
            if not line.strip(): continue
            parts = line.split(',')
            pid = safe_int(parts[0])
            proc_name = parts[1].strip()
            mem_used = safe_int(row[2]) if len(parts) > 2 else 0
            
            container_info = docker_map.get(pid)
            user = container_info['user'] if container_info else "system"
            container_name = container_info['containerName'] if container_info else None
            
            processes.append({
                "pid": pid,
                "type": "C",
                "processName": proc_name,
                "usedMemory": mem_used,
                "user": user,
                "containerName": container_name
            })
    except Exception:
        pass # プロセスがない場合
    return processes

@app.get("/metrics")
def metrics():
    try:
        cmd = [
            "nvidia-smi",
            "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit",
            "--format=csv,noheader,nounits"
        ]
        res = subprocess.check_output(cmd).decode("utf-8")
        reader = csv.reader(io.StringIO(res))
        
        gpus = []
        all_processes = get_gpu_processes()

        for row in reader:
            if len(row) < 10: continue
            
            # 安全にパース
            index = safe_int(row[0])
            name = row[1].strip()
            util_gpu = safe_int(row[2])
            util_mem = safe_int(row[3])
            mem_total = safe_int(row[4])
            mem_used = safe_int(row[5])
            mem_free = safe_int(row[6])
            temp = safe_int(row[7])
            power_draw = safe_int(row[8]) # Wattは整数表示で十分
            power_limit = safe_int(row[9])

            gpus.append({
                "index": index,
                "name": name,
                "utilization": {"gpu": util_gpu, "memory": util_mem},
                "memory": {"total": mem_total, "used": mem_used, "free": mem_free},
                "temperature": temp,
                "power": {"draw": power_draw, "limit": power_limit},
                "processes": all_processes
            })
            
        return {"status": "online", "gpus": gpus}
        
    except Exception as e:
        return {"status": "error", "message": str(e), "gpus": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### 3. 自動起動の設定 (Systemd)

サーバー再起動時にも自動的に監視エージェントが立ち上がるようにします。

```bash
# サービスファイルの作成
sudo nano /etc/systemd/system/gpu-monitor.service
```

以下の内容を貼り付けます：

```ini
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=/opt/gpu-monitor
ExecStart=/usr/local/bin/uvicorn monitor:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

保存してエディタを終了し、サービスを有効化・起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable gpu-monitor
sudo systemctl start gpu-monitor
```

---

### Step 3: ファイアウォール設定 (重要) 🛡️

`ERR_CONNECTION_RESET` や接続タイムアウトが発生する場合、サーバーのファイアウォールがポートをブロックしています。以下のコマンドでポートを開放してください。

#### GPUサーバー側 (エージェント用ポート: 8000)
```bash
# UFW (Ubuntu標準) の場合
sudo ufw allow 8000/tcp
sudo ufw reload

# Firewalld (CentOS/RHEL系) の場合
sudo firewall-cmd --add-port=8000/tcp --permanent
sudo firewall-cmd --reload
```

#### 管理者PC側 (Reactアプリ用ポート: 3000)
※ `npm start` でアプリをホストしているPCに対して、他のPCからアクセスする場合のみ必要です。

```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

---

### Step 4: ダッシュボードアプリの起動 (管理者PC)

再び管理者PC（リポジトリをクローンしたPC）に戻ります。

#### 1. 依存ライブラリのインストール
```bash
npm install
```

#### 2. アプリの起動
開発モードで起動します。

```bash
npm start
```

ブラウザで `http://localhost:3000`（または表示されたURL）にアクセスします。
右上の「Add Server」ボタンから、Step 2で設定したサーバーのIPアドレス（例: `192.168.1.50`）を追加してください。

---

## ❓ トラブルシューティング

### Q. IPアドレスを追加しても "Connection lost" になる
1. **IPアドレスの確認:** 登録したIPが、アプリを開いているPCから到達可能か (`ping 192.168.1.XX`) 確認してください。
2. **ファイアウォール:** Step 3のポート開放が行われているか確認してください。
3. **エージェント起動確認:** GPUサーバーで `sudo systemctl status gpu-monitor` を実行し、Activeになっているか確認してください。
4. **Mixed Content:** GitHub Pages (HTTPS) を使用している場合、HTTPのエージェントには接続できません。詳細は `docs/GITHUB_PAGES.md` を参照してください。

### Q. Dockerのユーザー名が表示されない
エージェントを実行しているユーザーが `docker` グループに所属していない可能性があります。
`monitor.py` を `root` 権限で実行するか、実行ユーザーをdockerグループに追加してください。
```bash
sudo usermod -aG docker $USER
# 再ログインが必要
```

---

### Step 5: Webサーバーへのデプロイ

このアプリを永続的にアクセス可能にする方法は2つあります。

#### A. 研究室内のサーバーで配信する（推奨）
研究室内のWebサーバー（nginxやApache）にビルドしたファイルを配置します。
```bash
npm run build
# build/ (または dist/) フォルダの中身をドキュメントルートへコピー
```
※ 同じLAN内であればHTTP同士で通信できるため、トラブルが少ない最も推奨される方法です。

#### B. GitHub Pages で公開する
インターネット上（`username.github.io`）から研究室内のサーバーを見に行きます。
**HTTPSとHTTPの混在（Mixed Content）問題**への対処が必要になります。

👉 **[詳細な手順と設定方法はこちらのドキュメントを参照してください](docs/GITHUB_PAGES.md)**