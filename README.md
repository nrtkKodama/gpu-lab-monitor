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
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

app = FastAPI()

# CORS設定: ブラウザや管理サーバーからのアクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
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

def get_docker_owner(pid: str) -> Dict[str, str]:
    """PIDからDockerコンテナの所有者と名前を特定する"""
    try:
        # 1. cgroupからコンテナIDを取得
        with open(f"/proc/{pid}/cgroup", "r") as f:
            cgroup_content = f.read()
            
        container_id = None
        for line in cgroup_content.splitlines():
            if "docker" in line:
                parts = line.split("/")
                if len(parts) > 0:
                    container_id = parts[-1]
                    break
        
        if not container_id:
            return {"user": "system", "container": ""}

        # 2. docker inspectで詳細を取得
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.Name}}|{{.Config.User}}", container_id],
            capture_output=True, text=True
        )
        
        if result.returncode == 0:
            name, user = result.stdout.strip().split("|")
            return {"user": user or "root", "container": name.lstrip("/")}
            
    except Exception:
        pass
        
    return {"user": "system", "container": ""}

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
                    # Docker情報の特定を試みる
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

---
#### setup_agant.shを使う場合

```bash
sed -i 's/\r$//' setup_agent.sh
sed -i 's/\xC2\xA0/ /g' setup_agent.sh

sudo bash setup_agent.sh
```
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

## ❓ トラブルシューティング

### Q. IPアドレスを追加しても "Connection lost" になる
1. **IPアドレスの確認:** 登録したIPが、アプリを開いているPCから到達可能か (`ping 192.168.1.XX`) 確認してください。(`curl http://192.168.1.XX:8000/metrics`)
2. **ファイアウォール:** `ufw` 以外のファイアウォール（AWS Security Groupやfirewalld）を使用している場合は、TCP 8000を開放してください。
3. **エージェント起動確認:** GPUサーバーで `sudo systemctl status gpu-monitor` を確認してください。
4. **Mixed Content:** GitHub Pages (HTTPS) を使用している場合、HTTPのエージェントには接続できません。詳細は `docs/GITHUB_PAGES.md` を参照してください。

### Q. Dockerのユーザー名が表示されない
エージェント (`gpu-monitor`) は root 権限で実行されるように設定されているため、通常は問題ありませんが、Dockerデーモンが停止している場合は表示されません。

### Q. LANスキャンが遅い / 見つからない
LANスキャン機能は、管理者PC（`npm start`しているPC）からネットワーク探索を行います。
管理者PCがGPUサーバーと同じLAN内に接続されていることを確認してください。
