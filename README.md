# 重ね太鼓

## 曲を追加
`content/songs/` に音源と譜面を含む `.osz`（または `.zip`）を置いて main にコミットします。サブフォルダも対応。`content/csv/charts.csv` に難易度設定、`content/csv/dan.csv` に段位設定を置けます。CSVの形式はゲームの読み込み画面を参照してください。GitHub Actions が一覧を自動生成し、Pages に反映します。

GitHub の Settings → Pages → Source を GitHub Actions に設定してください。

## 赤ノイズ
曲詳細の「赤ノイズを視覚的に編集」を開き、スライダーで時刻を移動。音符の左右をクリックして配置／解除します。左は左手（標準 D/F）、右は右手（J/K）が不可。同時押しは小ドン1＋小カツ1の列のみ対応します。

編集はブラウザに保存。「ノイズ設定を書き出す」で取得した `noise.json` を `content/noise.json` に置くと他のプレイヤーにも配信できます。ブラウザ内の編集が配信設定より優先されます。

## ローカル起動
Python 3 で `python3 scripts/build.py`、続いて `python3 -m http.server 8000`。ブラウザで http://localhost:8000 を開きます。HTMLの直接起動ではリポジトリの曲自動読込は無効ですが、従来のファイル読込は利用できます。
