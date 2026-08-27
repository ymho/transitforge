# Viewer bundle budget

Viewerの初期JavaScriptはMapboxとThree.jsから分離する

2026-08-27時点のproduction buildでは 分割前の単一chunk約2.65 MBに対して初期chunkは約284 KBになった

CIは`npm run bundle:check`で次の非圧縮上限を検査する

- initial `index`: 650 KiB
- Mapbox: 1,900 KiB
- Three.js: 900 KiB
- validation: 250 KiB

大きな描画依存はブラウザキャッシュを個別に利用できる一方 MapboxとThree.jsは起動時に必要なため遅延読込にはしていない
利用者へ不完全なViewerを見せるdynamic importは 専用の復旧UIを用意する変更と合わせて検討する
