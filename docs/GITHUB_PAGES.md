# GitHub Pages へのデプロイガイド

このアプリケーションを GitHub Pages (`username.github.io/repo-name`) で公開し、研究室のどこからでもアクセスできるようにする手順です。

## ⚠️ 重要な注意点：Mixed Content（混合コンテンツ）について

GitHub Pages は強制的に **HTTPS** で配信されます。一方で、研究室内のGPUサーバーのエージェント（`http://192.168.1.xxx:8000`）は通常 **HTTP** です。

ブラウザのセキュリティ仕様により、**HTTPSのページからHTTPのAPIを叩くことはブロックされます（Mixed Content エラー）。**

これを回避して GitHub Pages で動作させるには、以下の**いずれか**の対策が必要です。

1.  **ブラウザの設定で許可する（手軽・研究室内向け）**: Chromeなどの設定で、このサイトでの「安全でないコンテンツ」を許可する。
2.  **ngrok を使う（推奨）**: 各GPUサーバーを `ngrok` 等でHTTPS化して公開する。

---

## 手順 A: GitHub Pages へのデプロイ

### 1. リポジトリの準備
まだGitHubにリポジトリがない場合は作成し、ローカルのコードをプッシュしてください。

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git push -u origin main
```

### 2. `gh-pages` パッケージのインストール
ReactアプリをGitHub Pages用にビルド・デプロイするためのツールをインストールします。

```bash
npm install gh-pages --save-dev
```

### 3. `package.json` の編集
プロジェクトのルートにある `package.json` をエディタで開き、以下の2点を追加・修正します。

**追記1: `homepage` フィールドの追加（ファイルの先頭付近）**
```json
{
  "name": "gpu-lab-monitor",
  "homepage": "https://YOUR_USERNAME.github.io/REPO_NAME",
  // ...
}
```
※ `YOUR_USERNAME` と `REPO_NAME` は自分の環境に合わせて書き換えてください。

**追記2: `scripts` にデプロイコマンドを追加**
```json
"scripts": {
  "start": "react-scripts start",
  "predeploy": "npm run build",
  "deploy": "gh-pages -d build",
  // ...
}
```

### 4. デプロイの実行
以下のコマンドを実行すると、自動的にビルドが行われ、GitHubの `gh-pages` ブランチに公開されます。

```bash
npm run deploy
```

数分後、`https://YOUR_USERNAME.github.io/REPO_NAME` にアクセスできるようになります。

---

## 手順 B: GPUサーバーとの通信を成功させる

GitHub Pages（HTTPS）を開き、ダッシュボードにサーバーを追加しても、そのままでは「Connection lost」やエラーになります。ブラウザのコンソール（F12）を見ると `Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure resource 'http://...'. This request has been blocked` と表示されます。

以下のどちらかの方法で解決してください。

### 方法1: ブラウザで「安全でないコンテンツ」を許可する（PC側での設定）

閲覧するPCのブラウザ設定を変更し、一時的にブロックを解除します。

**Google Chrome / Edge の場合:**
1. GitHub Pages で公開したアプリのページを開く。
2. アドレスバーの左側にある「鍵アイコン（🔒）」の横、または「設定アイコン」をクリック。
3. 「サイトの設定」を開く。
4. 下の方にある **「安全でないコンテンツ (Insecure Content)」** を「ブロック (Block)」から **「許可 (Allow)」** に変更する。
5. ページをリロードする。

これで、HTTPSのページから研究室内のHTTPサーバーへ通信できるようになります。

### 方法2: ngrok でGPUエージェントをHTTPS化する（サーバー側での設定）

GPUサーバー側で `ngrok` を使い、一時的にHTTPSのURLを発行する方法です。これならブラウザ設定変更は不要です。

1. **GPUサーバー** に `ngrok` をインストールし、アカウント設定をする（無料版でOK）。
2. エージェント（ポート8000）を公開する:
   ```bash
   ngrok http 8000
   ```
3. 画面に表示される `https://xxxx-xxxx.ngrok-free.app` というURLをコピーする。
4. **GPU監視アプリ** の「Add Server」ボタンで、IPアドレスの代わりにこの **URL（https://...）** を入力する。
   ※ アプリ側の実装で `http://${ip}:8000` と固定されている場合は、`services/mockData.ts` の `fetchRealServerData` 関数を少し修正し、URLを直接受け取れるようにする必要があります。

---

## 補足: コードの修正が必要な場合

もし `ngrok` を使う場合（URL形式を入力する場合）、`services/mockData.ts` の `fetchRealServerData` は IPアドレスだけでなく URL も受け取れるように修正すると便利です。

```typescript
// 修正例
export const fetchRealServerData = async (inputAddress: string, name: string): Promise<ServerNode> => {
  // 入力が "http" で始まる場合はそのまま使い、そうでなければ従来のIP:8000形式にする
  const url = inputAddress.startsWith('http') 
    ? `${inputAddress}/metrics` 
    : `http://${inputAddress}:8000/metrics`;
    
  // ... (以下 fetch 処理)
};
```
