# コンシェルジュプロフィール

プロフィールの正本はこのディレクトリのTypeScript定義とする
画像は安定した公開URLを維持するため`public/assets/concierges`へ置く

新しいプロフィールを追加するときは次を同じ変更に含める

1. `<id>.ts`へ`ConciergeProfile`を定義
2. `index.ts`の`concierges`へ追加
3. `public/assets/concierges/<id>.webp`へWebP画像を追加
4. `presentation.image`を`/assets/concierges/<id>.webp`にする
5. `npm run assets:check`を実行

検査は画像の欠落 形式違い 未参照画像 IDとURLの不一致を拒否する
画像そのものとプロフィールの意味内容は自動判定しない
