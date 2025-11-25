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

def get_docker_map():
    """
    実行中のDockerコンテナのPIDとメタデータをマッピングする辞書を作成
    Returns: {pid: {name: str, user: str, image: str}}
    """
    docker_map = {}
    try:
        # 実行中の全コンテナのPID, 名前, Image, Config.Userを取得
        cmd = ["docker", "ps", "-q"]
        container_ids = subprocess.check_output(cmd).decode().split()
        
        if not container_ids:
            return {}

        inspect_cmd = ["docker", "inspect", "--format", "{{.State.Pid}},{{.Name}},{{.Config.User}},{{.Config.Image}}"] + container_ids
        output = subprocess.check_output(inspect_cmd).decode()
        
        for line in output.splitlines():
            if not line.strip(): continue
            parts = line.split(',')
            if len(parts) >= 4:
                pid = int(parts[0])
                name = parts[1].strip().lstrip('/') # 先頭の/を除去
                user = parts[2].strip()
                image = parts[3].strip()
                
                # ユーザーが空ならrootとする、またはイメージ名などをヒントにする
                if not user: user = "root"
                
                docker_map[pid] = {
                    "containerName": name,
                    "user": user,
                    "image": image
                }
    except Exception as e:
        print(f"Docker info fetch error: {e}")
    
    return docker_map

def get_gpu_processes():
    """
    nvidia-smiからプロセス情報を取得し、Docker情報と結合する
    """
    processes = []
    docker_map = get_docker_map()

    try:
        # PID, Process Name, Used Memory
        cmd = ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]
        output = subprocess.check_output(cmd).decode()
        
        for line in output.splitlines():
            if not line.strip(): continue
            parts = line.split(',')
            pid = int(parts[0])
            proc_name = parts[1].strip()
            mem_used = int(parts[2])
            
            # Dockerコンテナ内のプロセスかチェック
            # 正確にはプロセスの親PIDを辿る必要があるが、簡易的にPID直接一致またはcgroup確認が一般的
            # ここでは簡易実装としてPIDマッピングを使用 (※実際はPID Namespaceの違いによりホストPIDと異なる場合があるため注意)
            # より確実にするには /proc/{pid}/cgroup を読む必要がありますが、ここでは簡略化しています。
            
            # ホスト側PIDで見つかった場合
            container_info = docker_map.get(pid)
            
            user = "system"
            container_name = None
            
            if container_info:
                user = container_info['user']
                container_name = container_info['containerName']
            
            processes.append({
                "pid": pid,
                "type": "C", # Compute
                "processName": proc_name,
                "usedMemory": mem_used,
                "user": user,
                "containerName": container_name
            })
            
    except Exception as e:
        # プロセスがない場合など
        pass
        
    return processes

@app.get("/metrics")
def metrics():
    # 1. GPU基本情報の取得
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
            index = int(row[0])
            
            # このGPUに関連するプロセスだけをフィルタリング（簡易実装: 本来はgpu_uuid等で紐付けが必要）
            # ここでは全プロセスをリストに入れていますが、実運用では `nvidia-smi query-compute-apps` に `gpu_index` を含めてフィルタしてください
            
            gpus.append({
                "index": index,
                "name": row[1].strip(),
                "utilization": {
                    "gpu": int(row[2]),
                    "memory": int(row[3])
                },
                "memory": {
                    "total": int(row[4]),
                    "used": int(row[5]),
                    "free": int(row[6])
                },
                "temperature": int(row[7]),
                "power": {
                    "draw": float(row[8]),
                    "limit": float(row[9])
                },
                "processes": all_processes # ※簡略化のため全プロセスを返しています
            })
            
        return {"status": "online", "gpus": gpus}
        
    except Exception as e:
        return {"status": "error", "message": str(e), "gpus": []}

if __name__ == "__main__":
    import uvicorn
    # ポート8000で全IPからの接続を待機
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

### Step 3: ダッシュボードアプリの起動 (管理者PC)

再び管理者PC（リポジトリをクローンしたPC）に戻ります。

#### 1. 依存ライブラリのインストール
```bash
npm install
```

#### 2. モードの切り替え（重要）
デフォルトではデモ用のダミーデータが表示されるようになっています。
**実際のサーバーと通信するために、以下のファイルを編集してください。**

ファイル: `services/mockData.ts`

```typescript
// services/mockData.ts の末尾 (115行目付近)

// 変更前:
export const fetchServerData = fetchMockServerData;
// export const fetchServerData = fetchRealServerData;

// 変更後（コメントアウトを入れ替える）:
// export const fetchServerData = fetchMockServerData;
export const fetchServerData = fetchRealServerData;
```

#### 3. アプリの起動
開発モードで起動します。

```bash
npm start
```

ブラウザで `http://localhost:3000`（または表示されたURL）にアクセスします。
右上の「Add Server」ボタンから、Step 2で設定したサーバーのIPアドレス（例: `192.168.1.50`）を追加してください。

---

### Step 4: Webサーバーへのデプロイ

このアプリを永続的にアクセス可能にする方法は2つあります。

#### A. 研究室内のサーバーで配信する（推奨）
研究室内のWebサーバー（nginxやApache）にビルドしたファイルを配置します。
```bash
npm run build
# build/ フォルダの中身をドキュメントルートへコピー
```
※ 同じLAN内であればHTTP同士で通信できるため、トラブルが少ない最も推奨される方法です。

#### B. GitHub Pages で公開する
インターネット上（`username.github.io`）から研究室内のサーバーを見に行きます。
**HTTPSとHTTPの混在（Mixed Content）問題**への対処が必要になります。

👉 **[詳細な手順と設定方法はこちらのドキュメントを参照してください](docs/GITHUB_PAGES.md)**
