# 共通Style

Featureに依存しないtokenとViewer shellだけを置く

| ファイル | 所有する範囲 |
| --- | --- |
| `tokens.css` | 現行の色 影 Focus token |
| `legacy-theme-tokens.css` | 移行中の`--ui-*` token |
| `liquid-glass-foundation.css` | 時計 地図操作 Sheetに共通するLiquid Glass primitive |
| `map-layout.css` | Mapbox canvas HUD 地図操作のViewer shell |
| `legacy-responsive-overrides.css` | 旧mobile指定の交差部分 |
| `legacy-theme-overrides.css` | 旧theme指定の交差部分 |

`legacy-*`へ新しいselectorを追加しない
変更対象のselectorはConcierge Trip Plan Train Viewer Loading Screenの所有CSSへ移してから直す
画面固有のDOM classを参照する新規Styleは`frontend/src/presentation/<feature>`へ置く
