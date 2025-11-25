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

### Step 1: リポジトリのクローン

管理者PC（閲覧用）および監視対象のGPUサーバーで、このリポジトリをクローンします。

```bash
git clone https://github.com/your-username/gpu-lab-monitor.git
cd gpu-lab-monitor
```

---

### Step 2: 監視エージェントの起動 (GPUサーバー側)

**※この作業は、監視したい全てのGPUサーバーで行ってください。**

リポジトリに含まれている `monitor.py` を実行して、GPU情報を配信するWebサーバーを立ち上げます。

#### 1. 必要なPythonライブラリのインストール
```bash
sudo apt update
sudo apt install -y python3-pip
pip3 install -r requirements.txt
```
※ `requirements.txt` には `fastapi` と `uvicorn` が記載されています。

#### 2. エージェントの起動テスト
以下のコマンドを実行し、エラーが出ないことを確認します。

```bash
python3 monitor.py
```
成功すると `Uvicorn running on http://0.0.0.0:8000` と表示されます。

#### 3. 自動起動の設定 (Systemd)

サーバー再起動時にも自動的に監視エージェントが立ち上がるようにします。

```bash
# サービスファイルの作成
sudo nano /etc/systemd/system/gpu-monitor.service
```

以下の内容を貼り付けます。
**注意**: `/path/to/gpu-lab-monitor` の部分は、実際にcloneしたディレクトリのパス（例: `/home/labuser/gpu-lab-monitor`）に書き換えてください。

```ini
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=/path/to/gpu-lab-monitor
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

管理者PC（ダッシュボードを表示したいPC）で以下を実行します。

#### 1. 依存ライブラリのインストール
```bash
npm install
```

#### 2. アプリの起動
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
# build/ (または dist/) フォルダの中身をドキュメントルートへコピー
```
※ 同じLAN内であればHTTP同士で通信できるため、トラブルが少ない最も推奨される方法です。

#### B. GitHub Pages で公開する
インターネット上（`username.github.io`）から研究室内のサーバーを見に行きます。
**HTTPSとHTTPの混在（Mixed Content）問題**への対処が必要になります。

👉 **[詳細な手順と設定方法はこちらのドキュメントを参照してください](docs/GITHUB_PAGES.md)**
