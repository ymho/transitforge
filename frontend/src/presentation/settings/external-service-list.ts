export interface AccommodationProviderAttribution {
  displayName: string;
  creditUrl: string;
  creditImageUrl: string;
  creditAlt: string;
}

interface ExternalService {
  name: string;
  purpose: string;
  url: string;
  linkLabel: string;
}

const rakutenAttribution: AccommodationProviderAttribution = {
  displayName: "楽天トラベル",
  creditUrl: "https://travel.rakuten.co.jp/",
  creditImageUrl: "https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif",
  creditAlt: "楽天トラベル",
};

export const externalServiceNote = "参考資料は利用できる場合に参照します。各情報の出典・利用条件は表示箇所のリンクをご確認ください。";

/** Both settings surfaces use the same provider credits and descriptions. */
export function renderExternalServiceList(
  list: HTMLUListElement,
  accommodationAttribution?: AccommodationProviderAttribution | null,
): void {
  const accommodation = accommodationAttribution ?? rakutenAttribution;
  const services: ExternalService[] = [
    { name: "JRおでかけネット", purpose: "時刻表・観光資料", url: "https://www.jr-odekake.net/", linkLabel: "データ・資料の出典" },
    { name: "国土交通省 国土数値情報", purpose: "路線・駅の位置", url: "https://nlftp.mlit.go.jp/ksj/", linkLabel: "データの出典" },
    { name: "Mapbox", purpose: "地図・施設・移動経路", url: "https://www.mapbox.com/about/maps/", linkLabel: "地図の帰属表示" },
    { name: "OpenStreetMap contributors", purpose: "地図・道路データ", url: "https://www.openstreetmap.org/copyright", linkLabel: "著作権とライセンス" },
    { name: "OpenTripPlanner", purpose: "徒歩・バスの経路検索", url: "https://www.opentripplanner.org/", linkLabel: "提供元" },
    { name: "GTFS / GTFS-JP・公共交通オープンデータ", purpose: "バスの停留所・時刻表", url: "https://gtfs.org/", linkLabel: "データ形式" },
    { name: "Brave Search", purpose: "Web・写真検索", url: "https://search.brave.com/", linkLabel: "提供元" },
    { name: "Wikipedia / Wikimedia Commons", purpose: "観光情報・写真", url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use", linkLabel: "利用条件" },
    { name: "観光庁 多言語解説文データベース", purpose: "観光資源の解説", url: "https://www.mlit.go.jp/tagengo-db/", linkLabel: "資料の出典" },
    { name: "農林水産省 うちの郷土料理", purpose: "郷土料理・食文化", url: "https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/", linkLabel: "資料の出典" },
    { name: accommodation.displayName, purpose: "宿泊施設・参考料金", url: accommodation.creditUrl, linkLabel: accommodation.creditAlt },
    { name: "ホットペッパーグルメ Webサービス", purpose: "飲食店候補", url: "https://webservice.recruit.co.jp/", linkLabel: "ホットペッパーグルメ Webサービス" },
    { name: "Open-Meteo", purpose: "天気予報", url: "https://open-meteo.com/", linkLabel: "提供元" },
    { name: "気象庁", purpose: "警報・防災情報", url: "https://xml.kishou.go.jp/", linkLabel: "気象庁防災情報XML" },
    { name: "Amazon Bedrock", purpose: "AI旅行相談", url: "https://aws.amazon.com/bedrock/", linkLabel: "提供元" },
    { name: "Amazon Cognito", purpose: "ログイン認証", url: "https://aws.amazon.com/cognito/", linkLabel: "提供元" },
  ];
  const document = list.ownerDocument;
  list.className = "external-service-list";
  list.replaceChildren(...services.map(service => {
    const row = document.createElement("li");
    const purpose = document.createElement("span");
    purpose.textContent = service.purpose;
    const link = document.createElement("a");
    link.href = service.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = service.name;
    link.title = service.linkLabel;
    row.append(link, purpose);
    return row;
  }));
}
