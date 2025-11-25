# GPU Lab Monitor

研究室のGPUサーバー群を監視するためのダッシュボードアプリケーションです。
IPアドレスベースで管理し、ログイン（SSH）不要でブラウザから各マシンのGPU使用率、温度、実行中のDockerコンテナ所有者を確認できます。

## システム構成

このシステムは「エージェント型」の構成をとっています。

1.  **Dashboard (Frontend)**: このReactアプリケーション。ブラウザ上で動作し、各サーバーのAPIを叩いて情報を集約表示します。
2.  **Monitor Agent (Backend)**: 各GPUサーバー上で動作するPythonスクリプト。`nvidia-smi` や `docker` コマンドを実行し、結果をJSON形式のAPIとして公開します。

---

## 🚀 セットアップ手順

### Step 1: 監視対象サーバー（Agent）のセットアップ

監視したいすべてのGPUサーバー（Ubuntu等）で以下の作業を行います。

#### 1. 必要なツールのインストール
Python 3と `nvidia-smi` が使えることを確認し、FastAPIをインストールします。

```bash
sudo apt update && sudo apt install -y python3-pip
pip3 install fastapi uvicorn
```

#### 2. エージェントスクリプトの作成
適当なディレクトリ（例: `/opt/gpu-monitor`）を作成し、以下の `monitor.py` を保存してください。

**ファイル: `monitor.py`**

```python
import subprocess
import csv
import io
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORSを許可（ダッシュボードからのアクセスを受け入れる）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_gpu_info():
    try:
        # nvidia-smi からCSV形式で情報を取得
        cmd = [
            "nvidia-smi",
            "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit",
            "--format=csv,noheader,nounits"
        ]
        res = subprocess.check_output(cmd).decode("utf-8")
        reader = csv.reader(io.StringIO(res))
        
        gpus = []
        for row in reader:
            # 各行のデータをパース
            gpus.append({
                "index": int(row[0]),
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
                "processes": [] # プロセス情報は後で追加
            })
        return gpus
    except Exception as e:
        print(f"Error getting GPU info: {e}")
        return []

def get_processes():
    # ここにプロセス取得ロジック（docker ps と nvidia-smi の突き合わせ）を実装します
    # 簡易版として、nvidia-smi pmon の結果などをパースする処理になります
    # 実際の実装では `nvidia-smi --query-compute-apps=...` を使用してください
    return []

@app.get("/metrics")
def metrics():
    gpus = get_gpu_info()
    return {
        "status": "online",
        "gpus": gpus
    }

if __name__ == "__main__":
    import uvicorn
    # ポート8000でサーバーを起動
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### 3. 自動起動の設定 (Systemd)
サーバー再起動後も自動で起動するように設定します。

**ファイル: `/etc/systemd/system/gpu-monitor.service`**

```ini
[Unit]
Description=GPU Monitoring Agent
After=network.target

[Service]
User=root
WorkingDirectory=/opt/gpu-monitor
ExecStart=/usr/local/bin/uvicorn monitor:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

設定を反映し、起動します。
```bash
sudo systemctl daemon-reload
sudo systemctl enable gpu-monitor
sudo systemctl start gpu-monitor
```

---

### Step 2: ダッシュボード (Frontend) のセットアップ

このリポジトリのコードを使用します。

#### 1. 通信モードの切り替え
デフォルトではデモ用のモックデータが表示されるようになっています。
`services/mockData.ts` を開き、ファイルの最後にある `fetchServerData` 関数のエクスポートを切り替えてください。

```typescript
// services/mockData.ts

// モックデータを使用する場合（開発・デモ用）
// export const fetchServerData = fetchMockServerData;

// 実データを使用する場合（本番運用）
export const fetchServerData = fetchRealServerData;
```

#### 2. ビルドとデプロイ
Node.js がインストールされた環境で以下を実行します。

```bash
# 依存関係のインストール
npm install

# 本番用ビルド
npm run build
```

`build/` ディレクトリに静的ファイルが生成されます。これをWebサーバーで配信します。

##### 簡易的な配信方法（ローカルサーバー）
```bash
npx serve -s build
```
これで `http://localhost:3000` などでアクセス可能になります。

---

## ⚠️ 注意事項：GitHub PagesとMixed Contentについて

このアプリを **GitHub Pages (https://yourname.github.io/...)** で公開した場合、研究室内のGPUサーバー（通常は `http://192.168.x.x`）への通信はブロックされます。
これはブラウザのセキュリティ機能（Mixed Content Block）によるもので、**HTTPSのページからHTTPのAPIを叩くことができない**ためです。

**推奨される運用方法:**
1.  **学内サーバーでホスティング**: 監視対象のサーバーの1つ、または研究室内のWebサーバー（HTTP）にビルドしたファイルを配置して配信してください。
2.  **ローカル実行**: 各自のPCで `npm start` またはビルドしたファイルをローカルサーバーで起動して閲覧してください。
