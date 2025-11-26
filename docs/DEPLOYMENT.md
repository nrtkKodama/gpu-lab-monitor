# 自動起動の設定 (Systemd)

このダッシュボードアプリ（フロントエンド＋プロキシサーバー）をLinuxサーバー上で常時稼働させ、OS再起動時にも自動的に立ち上がるようにする手順です。

## 前提条件
* `npm install` と `npm run build` が完了していること。
* `npm start` で正常に起動することを確認済みであること。

## 1. サービスファイルの作成

`/etc/systemd/system/gpu-dashboard.service` ファイルを作成します。

```bash
sudo nano /etc/systemd/system/gpu-dashboard.service
```

以下の内容を貼り付けます。
**注意:** `User` と `WorkingDirectory` は、あなたの環境に合わせて変更してください。

```ini
[Unit]
Description=GPU Lab Monitor Dashboard
After=network.target

[Service]
# アプリを実行するユーザー名 (例: ubuntu, pi, root など)
User=YOUR_USERNAME

# アプリのディレクトリパス (git cloneした場所)
WorkingDirectory=/home/YOUR_USERNAME/gpu-lab-monitor

# 実行コマンド (npm start)
# Node.jsのパスは環境によって異なる場合があります (`which node` で確認可能)
ExecStart=/usr/bin/npm start

# 環境変数 (必要に応じてポートを変更)
Environment=PORT=3000
Environment=NODE_ENV=production

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 2. サービスの有効化と起動

```bash
# 設定を反映
sudo systemctl daemon-reload

# 自動起動を有効化
sudo systemctl enable gpu-dashboard

# 今すぐ起動
sudo systemctl start gpu-dashboard
```

## 3. ステータスの確認

```bash
sudo systemctl status gpu-dashboard
```

緑色の丸印（Active: active (running)）が表示されていれば成功です。
ブラウザから `http://[サーバーのIP]:3000` にアクセスして確認してください。

---

## 補足: PM2を使う場合 (簡易版)

Node.jsのプロセス管理ツール `pm2` を使う方法もあります。

```bash
# インストール
sudo npm install -g pm2

# ビルド済みであることを確認
npm run build

# 起動
pm2 start server.js --name "gpu-dashboard"

# 自動起動設定の生成
pm2 startup
# (表示されたコマンドを実行する)
pm2 save
```
