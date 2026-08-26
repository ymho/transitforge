# Presentation

ブラウザへ表示するView DOM操作 CSS Three.js描画を画面機能ごとに所有する

- `concierge`: 会話 プロフィール 経路候補
- `trip-plan`: 旅程表示と編集提案
- `train-viewer`: 列車操作 詳細 時刻表とThree.js描画
- `shared`: 複数画面が同じ契約で使う状態を持たないView primitive
- `styles`: Viewer shellと共通token CSS entrypoint

外部データはComposition RootからPortまたは値として受け取り HTTPやLocalStorageの
具体実装を直接生成しない `shared`には画面固有の語彙や状態を追加しない
