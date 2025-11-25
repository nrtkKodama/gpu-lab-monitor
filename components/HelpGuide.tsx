import React from 'react';
import { Terminal, Settings, Save, Server, Shield, Globe, HelpCircle, AlertTriangle, PlayCircle } from 'lucide-react';

const HelpGuide: React.FC<{onClose: () => void}> = ({ onClose }) => {
  return (
    <div className="bg-gray-800 rounded-xl p-8 max-w-4xl mx-auto shadow-2xl border border-gray-700 text-gray-300 leading-relaxed overflow-y-auto max-h-[85vh] custom-scrollbar">
      <div className="flex justify-between items-start mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold text-white">システムセットアップ & デプロイガイド</h1>
        <button onClick={onClose} className="text-gray-400 hover:text-white">✕ 閉じる</button>
      </div>

      <div className="space-y-8">
        
        {/* Troubleshooting Section (Priority) */}
        <section className="bg-red-900/20 border border-red-800/50 rounded-lg p-5">
           <h2 className="text-xl font-bold text-red-200 mb-4 flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400"/> トラブルシューティング
          </h2>
          
          <div className="space-y-4">
             <div className="bg-gray-900/50 p-4 rounded border border-gray-700">
               <h3 className="text-white font-bold text-sm mb-2 flex items-center gap-2">
                 ⚠️ Ping: OK, Agent: NG となる場合 (グローバルIP等)
               </h3>
               <p className="text-sm mb-2">
                 グローバルIP (例: <code>133.34.x.x</code>) のサーバーを追加した際にこのエラーが出る場合、
                 <strong>大学や組織のファイアウォールが Port 8000 を外部からブロックしています。</strong>
               </p>
               <p className="text-sm mb-3">以下のいずれかの方法で解決してください。</p>

               <div className="space-y-3">
                 <div className="bg-black/40 p-3 rounded">
                   <p className="text-green-400 text-xs font-bold mb-1">【推奨】 SSHトンネルを使う</p>
                   <p className="text-xs text-gray-400 mb-2">
                     手元のPCでSSHトンネルを掘り、ローカル経由でアクセスします。安全でファイアウォール変更も不要です。
                   </p>
                   <code className="block bg-black p-2 rounded text-xs font-mono text-gray-300 select-all">
                     # 手元のPCのターミナルで実行 (ポート8001を使う例)<br/>
                     ssh -L 8001:localhost:8000 user@133.34.xx.xx
                   </code>
                   <p className="text-xs text-gray-400 mt-2">
                     → アプリの「Add Server」には <code className="text-white">localhost:8001</code> と入力して登録してください。
                   </p>
                 </div>

                 <div className="bg-black/40 p-3 rounded">
                   <p className="text-orange-400 text-xs font-bold mb-1">【代替】 ngrokを使う</p>
                   <p className="text-xs text-gray-400">
                     GPUサーバー側で <code>ngrok http 8000</code> を実行し、発行されたURL (https://...) を登録してください。
                   </p>
                 </div>
               </div>
             </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <HelpCircle size={20} className="text-pink-400"/> よくある質問: パスワードは不要？
          </h2>
          <div className="bg-gray-700/50 p-4 rounded-lg border-l-4 border-pink-500">
            <h3 className="font-bold text-white mb-2">Q. IPアドレスだけで、ログインなしで監視できるのですか？</h3>
            <p className="mb-2">
              <strong>A. はい、可能です。</strong><br/>
              このシステムはSSHでログインするのではなく、各サーバーが自分の情報をWebサーバーとして公開する「エージェント方式」を採用しているためです。
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-gray-300">
              <li>Webサイトを閲覧するのにパスワードが不要なのと同様に、各サーバーの状況（API）にアクセスするだけなので認証は必須ではありません。</li>
              <li>情報の「閲覧」のみが可能で、サーバーの再起動や停止などの「操作」はできないため、セキュリティリスクは限定的です。</li>
              <li>※研究室外からアクセスさせたい場合などは、VPNを通すか、Basic認証などを導入してください。</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Server size={20} className="text-blue-400"/> 1. アーキテクチャ概要
          </h2>
          <p className="mb-2">
            このアプリケーションはフロントエンド(React)です。実際のGPUデータを取得するには、各監視対象サーバーで軽量なバックエンドAPIを実行する必要があります。
          </p>
          <div className="bg-gray-900 p-4 rounded-lg font-mono text-xs overflow-x-auto border border-gray-700">
            [GPU Server] (Agent Running on :8000) <br/>
            &nbsp;&nbsp;↳ nvidia-smiの結果を JSON で配信 (http://IP:8000/metrics) <br/>
            <br/>
            [Dashboard PC] (This App) <br/>
            &nbsp;&nbsp;↳ ブラウザまたは管理サーバー経由でデータを取得・表示 <br/>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Terminal size={20} className="text-green-400"/> 2. サーバー側エージェントのセットアップ
          </h2>
          <p className="mb-4">
            各GPUサーバーで以下のPythonスクリプト(<code>monitor.py</code>)を実行してください。
            <br/>
            <span className="text-sm text-gray-400">※詳細なセットアップ手順はREADME.mdを参照してください。</span>
          </p>
          <div className="bg-black/30 p-3 rounded border border-gray-600">
            <p className="text-sm font-bold text-green-400 mb-2">起動コマンド:</p>
            <code className="font-mono text-sm text-gray-300">python3 monitor.py</code>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Globe size={20} className="text-indigo-400"/> 3. Webデプロイ時の注意 (Mixed Content)
          </h2>
          <div className="bg-yellow-900/30 border border-yellow-700/50 p-4 rounded-lg">
            <h3 className="font-bold text-yellow-500 mb-2">⚠️ HTTPSとHTTPの混在について</h3>
            <p className="text-sm mb-2">
              GitHub Pages (HTTPS) から 学内のGPUサーバー (HTTP) へ直接通信することは、ブラウザのセキュリティ制限によりブロックされます。
            </p>
            <p className="text-sm font-bold mt-2">推奨されるデプロイ方法:</p>
            <ul className="list-disc list-inside text-sm ml-2 mt-1 space-y-1">
              <li><strong>方法A (推奨):</strong> 監視対象サーバーの1つでこのReactアプリをビルドし、同じネットワーク内で HTTP として配信する。</li>
              <li><strong>方法B:</strong> ローカルPCで <code>npm start</code> して利用する。</li>
            </ul>
          </div>
        </section>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(31, 41, 55, 0.5); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(75, 85, 99, 0.8); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 1); }
      `}</style>
    </div>
  );
};

export default HelpGuide;