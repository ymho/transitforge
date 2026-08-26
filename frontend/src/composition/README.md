# Composition Root

`main.ts`から呼ばれ Browser Adapter Usecase Presentation Feature設定を組み立てる
外部接続やDOMの具体実装を生成できるFrontend内の唯一の場所とする

業務判断や検索処理はここへ追加せず`usecases`またはshared Domainへ抽出する
現在のViewer起動手順は`viewer-composition.ts`に集約し 機能単位で段階的にUsecaseへ移す
