> Original 1.0.0 development notes below are historical. This branch adds an uninstalled native updater prototype; see [NATIVE-UPDATES.md](NATIVE-UPDATES.md). `tools/build.py` now emits a separately named prototype source ZIP, not the published release.

# 開発・保守 — 1.0.0

`extension/` の素のJS・HTML・CSSが全実行時ソースです。ビルド、ライブラリー、外部リソース、Node、Pythonは通常利用に不要です。

## 実装

- `manifest.json`：MV3、storage権限、4ホストのHTTPS `/search` と `/search?*`、最上位フレームだけ、document_start注入。製品バージョンは1.0.0。
- `content.css`：`#rcnt`内の本文ID、完全一致属性、`data-attnms`、`folsrch`＋`data-aim=1`、マーカーを伴う既知の専用枠を非表示にする。中段の汎用枠は唯一の子の鎖に絞る。共通結果ルートを全分岐で保護し、通常記事・h3・既知ウィジェットがAIマーカー外にあればその枠を残す。
- `content.js`：設定の読込、変更通知、ルート属性の反映、BFCache復帰時の再読込のみ。読込ごと・変更通知ごとにrevisionを進め、古い結果を抑制。読込失敗は非表示解除。値が同じ場合の属性書込を抑制。
- `popup.js`：保存callbackの成功を確認し、失敗では最新の確定状態に戻す。保存中の多重操作を抑え、他contextからの変更も反映。
- `popup.html` / `popup.css`：日本語スイッチ1個。キーボード、フォーカス、dark/forced-colors対応。外部フォントなし。

CSSは見出しの文字列を検査しません。`:has()`は候補として名前を指定した枠に限定します。独自DOM監視・祖先探索・定期走査・タイマーはありません。Google側のinline display重要指定に備えて、非表示候補にはvisibility/content-visibility/寸法等も指定します。元の要素・本文・inline styleは保持します。

Chromeエンジン105下限は`:has()`構文の要件で、各製品の古い版の対応を実証した数値ではありません。最新版の各製品での実拡張確認が必要です。

## 試験

標準Nodeだけで実行するモック／静的試験：

```sh
node tests/unit.cjs
```

Blink描画・回帰・負荷測定には、開発用playwrightとローカルChromiumまたはChrome Headless Shellを別途用意します。これらは配布物に含めません。

```sh
npm install --prefix /tmp/search-clean-test-deps playwright
NODE_PATH=/tmp/search-clean-test-deps/node_modules CHROMIUM_EXECUTABLE=/absolute/path/to/chrome-headless-shell node tests/fixture.cjs
NODE_PATH=/tmp/search-clean-test-deps/node_modules CHROMIUM_EXECUTABLE=/absolute/path/to/chrome-headless-shell node tests/regression.cjs
NODE_PATH=/tmp/search-clean-test-deps/node_modules CHROMIUM_EXECUTABLE=/absolute/path/to/chrome-headless-shell node tests/performance.cjs
```

PowerShellでは環境変数を `$env:NODE_PATH` と `$env:CHROMIUM_EXECUTABLE` で設定してからnodeコマンドを実行します。実行ファイルの環境変数を省略するとPlaywright既定のChromiumです。Linuxコンテナーの描画試験には `--no-sandbox` を指定しています。利用者のブラウザー設定や拡張本体のコードへ適用する指定ではありません。

`SCREENSHOT_DIR`を指定すると基本試験で一時PNGを出力します。試験HTMLとAPIモックは、実拡張の隔離環境、実storage、新タブ・再起動保持、実Googleを検証するものではありません。

Chrome自身による構造検証：

```sh
CHROME_EXECUTABLE=/absolute/path/to/chrome python3 tests/package.py
```

正規のパッケージ化経路を使い、正常版の受理と故意の欠陥4種類の拒否を確認します。試験用CRX・鍵は自動削除する一時ディレクトリー内だけに作ります。実拡張の読み込み確認とは別です。

## ZIP再作成

```sh
python3 tools/build.py
```

プロジェクトの隣へ `Search-Clean-Lite-1.0.0.zip` を作ります。依存フォルダー・キャッシュ・ログ・ZIPは除外します。アイコンの原デザインは `tools/icon.svg`、PNG再生成は `tools/make_icons.py`（開発時のみPillow）。

## 1.0.0で追加・修正したこと

1. `data-attnms`、初期ローディング領域、上部・中段の専用枠へのCSS対応。
2. 全分岐で共通結果ルートを除外し、通常記事・ウィジェット混在枠の保護を追加。
3. inline display重要指定があっても非表示候補を折りたたむ補助指定。
4. 同時に残る設定読込結果の逆順完了に対する競合修正。
5. Node41、Blink基本11＋回帰25、Chrome構造5、オフライン負荷測定のソースと記録を同梱。

## 一次資料と採用の根拠

2026年10月27日に調査。Google実DOMを直接観測したものではなく、Googleが固定仕様として保証する識別子であることも確認していません。

| 識別子／手順 | 一次資料 |
| --- | --- |
| `data-attnms`、上部 `.Kevs9.SLPe5b`、中段枠の関係 | https://github.com/Stevoisiak/Stevos-AI-Blocklist/blob/main/GenAI-Blocklist.txt 、取得blob SHA `84bf039392a038408c3dd93cb7261cecb82d1b8d`、L2196–2201 |
| マーカーの多言語利用に関する作者説明 | https://github.com/easylist/easylist/issues/23432#issuecomment-4060906085 |
| folsrch領域のフィルター | https://github.com/AdguardTeam/AdguardFilters/blob/master/AnnoyancesFilter/Other/sections/annoyances.txt 、取得blob SHA `8bc6479e20b74e0e92fc4df13987141f2e8ef920`、L325–329 |
| 初期領域の `data-async-type=folsrch` と `data-aim=1` | https://discoveredlabs.com/blog/how-google-ai-overviews-works 、2026年6月2日の作者による解析 |
| 本文 `#m-x-content` と完全一致属性の候補 | https://github.com/paulgegenyi/deslop/blob/main/content.js 、取得blob SHA `9042b550fdb4415435764322618053d9f2003003` |
| `.hdzaWe` / `.Wm5I1e` の枠候補 | https://github.com/asahisuenaga/Hide-Google-AI/blob/main/src/assets/js/content.js 、取得blob SHA `596d2dfb88cc20ea52688210acdfd091afe0033f` |
| 本文内の複数レイアウト | https://cloro.dev/blog/scrape-google-search/ |
| content script、storageの仕様 | https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts 、https://developer.chrome.com/docs/extensions/reference/api/storage |

唯一の子の鎖、共通ルート除外、通常記事ガードは今回の独自の保守策です。原フィルターを丸ごと組み込んだものではありません。root全体を対象にした`:has()`、文言だけによる判定、汎用data-hveid祖先の一括削除、前の枠全体の削除は採用していません。

導入手順の資料：

- Chrome： https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
- Edge： https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading
- Brave公式開発リポジトリのQA： https://github.com/brave/brave-browser/issues/26207
- Vivaldi： https://help.vivaldi.com/desktop/appearance-customization/extensions/
- Opera： https://help.opera.com/en/extensions/testing/

## 表示変更への更新

実GoogleのOFF状態でAI専用枠を確認し、本文・見出し・余白と通常結果の境界を調べてCSSを更新します。新しい識別子の候補は、通常記事の文言、共有祖先、混在ウィジェット、遅延追加、OFF復元を再確認してください。保護ガードが働いて外側の見出し・余白が残るケースは、実際の境界を確認してから狭く追加します。
