# GPU Lab Monitor

研究室のGPUサーバー群を一元管理する監視ダッシュボードです。
各サーバーのGPU使用率、温度、電力、そして**現在誰が（どのDockerコンテナが）GPUを使用しているか**を可視化します。

SSHログインやパスワード管理は不要。IPアドレスを登録するだけで、Webブラウザからクラスタ全体の状況を把握できます。

---

## 🛠 前提条件

**管理者PC (フロントエンド表示用)**
- Node.js (v16以上推奨)
- Git
- (推奨) ngrok アカウント

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
SSHでGPUサーバーにログインし、以下の手順を実行します。

#### 1. 必要なパッケージのインストール

Python環境とWebサーバー用ライブラリをインストールします。

```bash
sudo apt update
sudo apt install -y python3 python3-pip
pip3 install fastapi "uvicorn[standard]"
```

#### 2. エージェント用ディレクトリとファイルの作成

監視スクリプト `monitor.py` を作成します。
以下のコードブロックをすべてコピーして、サーバー上の `/opt/gpu-monitor/monitor.py` として保存してください。

```bash
# ディレクトリ作成
sudo mkdir -p /opt/gpu-monitor
cd /opt/gpu-monitor

# ファイル作成 (nano等でエディタを開き、下のPythonコードを貼り付けて保存)
sudo nano monitor.py
```

**monitor.py の内容:**

```python
import subprocess
import csv
import io
import json
import uvicorn
import pwd
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

app = FastAPI()

# CORS設定: ブラウザや管理サーバーからのアクセスを許可
# 注意: 古いバージョンのfastapi/starletteではallow_private_networkが未対応のため削除済み
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def safe_float(value: Any) -> float:
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0

def safe_int(value: Any) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0

def resolve_uid(user_val: str) -> str:
    """UID(数値文字列)であればユーザー名に変換する"""
    if not user_val:
        return ""
    try:
        # 数値かどうかチェック
        uid = int(user_val)
        # pwdモジュールでユーザー名を取得
        return pwd.getpwuid(uid).pw_name
    except (ValueError, KeyError, OverflowError):
        # 数値でない、またはユーザーが存在しない場合はそのまま返す
        return user_val

def get_docker_owner(pid: str) -> Dict[str, str]:
    """
    PIDからDockerコンテナの所有者と名前を特定する
    環境変数、ラベル、ホストプロセス所有者などを複合的にチェックして「真のユーザー」を探します。
    """
    # 0. ホストOS上のプロセス所有者を取得 (フォールバックとして有用)
    host_user = "unknown"
    try:
        # ps -o user= -p PID
        proc = subprocess.run(["ps", "-o", "user=", "-p", str(pid)], capture_output=True, text=True)
        if proc.returncode == 0:
            raw_user = proc.stdout.strip()
            # UIDの場合は名前に変換
            host_user = resolve_uid(raw_user)
    except:
        pass

    try:
        # 1. cgroupからコンテナIDを取得
        container_id = None
        with open(f"/proc/{pid}/cgroup", "r") as f:
            for line in f:
                if "docker" in line or "kubepods" in line:
                    parts = line.strip().split("/")
                    if parts:
                        cid = parts[-1]
                        # systemd scopeやdocker-プレフィックスの除去
                        if cid.endswith(".scope"): cid = cid[:-6]
                        if cid.startswith("docker-"): cid = cid[7:]
                        
                        if len(cid) >= 12:
                            container_id = cid
                            break
        
        # コンテナでない場合、ホストユーザーを返す
        if not container_id:
            return {"user": host_user if host_user != "unknown" else "system", "container": ""}

        # 2. docker inspectで詳細メタデータを取得
        # Name, Config.User, Config.Env, Config.Labels を一括取得
        cmd = ["docker", "inspect", "--format", "{{json .}}", container_id]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return {"user": host_user, "container": "unknown-container"}
            
        data = json.loads(result.stdout)
        
        name = data.get("Name", "").lstrip("/")
        config = data.get("Config", {})
        labels = config.get("Labels", {}) or {}
        env_list = config.get("Env", []) or []
        config_user = config.get("User", "")
        
        # User指定が "1001" や "1001:1001" の場合があるので解決する
        if config_user:
            if ":" in config_user:
                config_user = config_user.split(":")[0]
            config_user = resolve_uid(config_user)

        # --- ヒューリスティック 1: 環境変数 (研究室でよく使われる変数を優先) ---
        env_map = {}
        for e in env_list:
            if "=" in e:
                k, v = e.split("=", 1)
                env_map[k] = v
        
        # チェックする環境変数の優先順位
        target_envs = ["JUPYTERHUB_USER", "NB_USER", "SUDO_USER", "USER", "USERNAME", "OWNER", "LOGNAME", "GIT_AUTHOR_NAME"]
        for key in target_envs:
            if key in env_map:
                val = env_map[key]
                # デフォルト値っぽいものは無視
                if val and val not in ["root", "jovyan", "ubuntu", "1000", "node", "app"]:
                    return {"user": val, "container": name}

        # --- ヒューリスティック 2: Docker Labels ---
        # docker-composeのプロジェクト名はユーザー名であることが多い
        if "com.docker.compose.project" in labels:
            return {"user": labels["com.docker.compose.project"], "container": name}
        if "maintainer" in labels:
            return {"user": labels["maintainer"], "container": name}
        if "user" in labels:
            return {"user": labels["user"], "container": name}

        # --- ヒューリスティック 3: ホストプロセスの所有者 ---
        # root以外のユーザーがコンテナを起動している場合、それが最も正確
        if host_user not in ["root", "dockremap", "unknown"]:
            return {"user": host_user, "container": name}

        # --- ヒューリスティック 4: Config User (フォールバック) ---
        if config_user and config_user not in ["root", "0", "1000", "jovyan"]:
            return {"user": config_user, "container": name}

        # 最終手段
        return {"user": "system", "container": name}
            
    except Exception:
        # エラー時はホストユーザーを返す
        return {"user": host_user if host_user != "unknown" else "system", "container": ""}

@app.get("/")
def root():
    return {"status": "GPU Monitor Agent is Running. Access /metrics for data."}

@app.get("/metrics")
def get_metrics():
    try:
        # nvidia-smiでGPU情報をCSV形式で取得
        cmd = [
            "nvidia-smi", 
            "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit", 
            "--format=csv,noheader,nounits"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        
        if res.returncode != 0:
            return {"status": "error", "message": "nvidia-smi failed"}

        reader = csv.reader(io.StringIO(res.stdout))
        gpus = []
        
        for row in reader:
            if len(row) < 10: continue
            index = safe_int(row[0])
            
            # 各GPUで実行中のプロセス情報を取得
            proc_cmd = [
                "nvidia-smi", 
                "--query-compute-apps=gpu_uuid,pid,process_name,used_memory", 
                "--format=csv,noheader,nounits",
                "-i", str(index)
            ]
            proc_res = subprocess.run(proc_cmd, capture_output=True, text=True)
            processes = []
            
            if proc_res.returncode == 0 and proc_res.stdout.strip():
                proc_reader = csv.reader(io.StringIO(proc_res.stdout))
                for p_row in proc_reader:
                    if len(p_row) < 4: continue
                    pid = p_row[1].strip()
                    # Docker情報の特定を試みる (高精度版)
                    docker_info = get_docker_owner(pid)
                    
                    processes.append({
                        "pid": safe_int(pid),
                        "type": "C",
                        "processName": p_row[2].strip(),
                        "usedMemory": safe_int(p_row[3]),
                        "user": docker_info["user"],
                        "containerName": docker_info["container"]
                    })

            gpus.append({
                "index": index,
                "name": row[1].strip(),
                "utilization": {
                    "gpu": safe_int(row[2]),
                    "memory": safe_int(row[3])
                },
                "memory": {
                    "total": safe_float(row[4]),
                    "used": safe_float(row[5]),
                    "free": safe_float(row[6])
                },
                "temperature": safe_int(row[7]),
                "power": {
                    "draw": safe_float(row[8]),
                    "limit": safe_float(row[9])
                },
                "processes": processes
            })

        return {"status": "online", "gpus": gpus}
        
    except Exception as e:
        return {"status": "error", "message": str(e), "gpus": []}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### 3. 自動起動の設定 (Systemd)

サーバー再起動後も自動的にエージェントが起動するように設定します。

```bash
# 設定ファイルを作成
sudo nano /etc/systemd/system/gpu-monitor.service
```

以下の内容を貼り付けて保存してください。

```ini
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=/opt/gpu-monitor
ExecStart=/usr/bin/python3 monitor.py
Restart=always

[Install]
WantedBy=multi-user.target
```

サービスを有効化して起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable gpu-monitor
sudo systemctl start gpu-monitor
```

#### 4. ファイアウォールの設定

ポート8000番を開放します。

```bash
sudo ufw allow 8000/tcp
sudo ufw reload
```

#### 5. 動作確認

以下のコマンドでJSONが返ってくれば成功です。

```bash
curl http://localhost:8000/metrics
```
#### setup_agant.shを使う場合

```bash
sed -i 's/\r$//' setup_agent.sh
sed -i 's/\xC2\xA0/ /g' setup_agent.sh

sudo bash setup_agent.sh
```

---

### Step 3: ダッシュボードアプリの起動 (管理者PC)

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

## 🌍 外部公開・デプロイ (ngrok 推奨)

研究室外（自宅や外出先）からアクセスする場合、**ngrok を管理者PC（フロントエンド）にのみ導入する**方法が最も簡単で安全です。

### アーキテクチャ

管理者PCが「中継役（プロキシ）」となり、外部からのアクセスを研究室内の各GPUサーバーへ橋渡しします。
この構成により、各GPUサーバーを外部に公開する必要がありません。

```text
[ 自宅PC / スマホ ]
       ↓ (https://xxxx.ngrok-free.app)
[ ngrok Cloud ]
       ↓
[ 管理者PC (Lab) ] <-- npm start (Port 3000)
       ↓ (LAN内通信 / Proxy)
[ GPU Server 1 ] (192.168.1.50:8000)
[ GPU Server 2 ] (192.168.1.51:8000)
...
```

### デプロイ手順

1. **ngrokのインストール (管理者PC)**
   [ngrok公式サイト](https://ngrok.com/download)からダウンロードし、インストールします。

2. **アプリの起動**
   管理者PCで通常通りアプリを起動します。
   ```bash
   npm start
   ```

3. **ngrokの起動**
   新しいターミナルを開き、ポート3000を公開します。
   ```bash
   ngrok http 3000
   ```

4. **アクセスの共有**
   ngrokが発行したURL（例: `https://abcd-1234.ngrok-free.app`）にアクセスすれば、どこからでもダッシュボードを閲覧できます。
   
   **注意:** フロントエンドの機能により、外部からのアクセス時は自動的に「プロキシモード」に切り替わり、管理者PC経由でデータを取得します。

---

## 🛠 新機能: 設定のバックアップとSSH連携

ナビゲーションバーの **「設定」** ボタンから以下の機能が利用できます。

### 1. 設定データのバックアップ (Export/Import)
- 登録したサーバーリストをJSONファイルとしてダウンロードできます。
- ブラウザのキャッシュをクリアする場合や、他のPCでダッシュボードを利用する場合に、このJSONファイルをインポートすることで環境を復元できます。

### 2. SSH Configの自動生成
- 登録したサーバー情報を元に `~/.ssh/config` に貼り付けられる設定テキストを生成します。
- これを利用すると、IPアドレスを毎回入力せず `ssh server-name` だけで接続できるようになります。

---

## ❓ トラブルシューティング

### Q. IPアドレスを追加しても "Connection lost" になる
1. **IPアドレスの確認:** 登録したIPが、アプリを開いているPCから到達可能か (`ping 192.168.1.XX`) 確認してください。
2. **ファイアウォール:** `ufw` 以外のファイアウォール（AWS Security Groupやfirewalld）を使用している場合は、TCP 8000を開放してください。
3. **エージェント起動確認:** GPUサーバーで `sudo systemctl status gpu-monitor` を確認してください。
4. **Mixed Content:** GitHub Pages (HTTPS) を使用している場合、HTTPのエージェントには接続できません。詳細は `docs/GITHUB_PAGES.md` を参照してください。

### Q. Dockerのユーザー名が表示されない
エージェント (`gpu-monitor`) は root 権限で実行されるように設定されているため、通常は問題ありませんが、Dockerデーモンが停止している場合は表示されません。

### Q. LANスキャンが遅い / 見つからない
LANスキャン機能は、管理者PC（`npm start`しているPC）からネットワーク探索を行います。
管理者PCがGPUサーバーと同じLAN内に接続されていることを確認してください。
