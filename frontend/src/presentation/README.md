# 共通Presentation

複数Featureから同じ意味で利用する 状態を持たないView primitiveだけを置く

現在の共通要素は次の2つ

- `loading-screen`: Application起動全体の状態表示
- `sheet-transition`: ConciergeとTrain Detailsが共有するSheet開閉規則

会話 旅程 列車 日時などFeatureの語彙を持つViewとCSSはここへ置かない
共有候補は2つ以上のFeatureで同じ契約を使い 外部通信やFeature状態を所有しない場合だけ追加する
