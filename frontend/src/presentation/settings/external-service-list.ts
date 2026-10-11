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
  imageUrl?: string;
  imageAlt?: string;
}

const rakutenAttribution: AccommodationProviderAttribution = {
  displayName: "楽天トラベル",
  creditUrl: "https://travel.rakuten.co.jp/",
  creditImageUrl: "https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif",
  creditAlt: "楽天トラベル",
};

export const externalServiceNote = "旅行・食文化の参考資料には、利用できる場合に参照する収集対象も含みます。写真・施設情報・交通データの出典は、各表示箇所にも記載します。個別の著作物は提供元の利用条件に従い、地図の帰属表示は地図画面にも常時表示します。";

/** Both settings surfaces use the same provider credits and descriptions. */
export function renderExternalServiceList(
  list: HTMLUListElement,
  accommodationAttribution?: AccommodationProviderAttribution | null,
): void {
  const accommodation = accommodationAttribution ?? rakutenAttribution;
  const services: ExternalService[] = [
    { name: "JRおでかけネット", purpose: "鉄道時刻表・旅行と観光の参考資料", url: "https://www.jr-odekake.net/", linkLabel: "データ・資料の出典" },
    { name: "国土交通省 国土数値情報", purpose: "鉄道路線・駅の位置情報", url: "https://nlftp.mlit.go.jp/ksj/", linkLabel: "データの出典" },
    { name: "Mapbox", purpose: "地図・地形・施設検索、徒歩・車・自転車の移動", url: "https://www.mapbox.com/about/maps/", linkLabel: "地図の帰属表示" },
    { name: "OpenStreetMap contributors", purpose: "地図・徒歩とバスの経路に使う道路データ", url: "https://www.openstreetmap.org/copyright", linkLabel: "著作権とライセンス" },
    { name: "OpenTripPlanner", purpose: "徒歩・バスの経路検索", url: "https://www.opentripplanner.org/", linkLabel: "提供元" },
    { name: "GTFS / GTFS-JP・公共交通オープンデータ", purpose: "バスの停留所・時刻表。提供元は各経路に表示", url: "https://gtfs.org/", linkLabel: "データ形式" },
    { name: "Brave Search", purpose: "観光情報のWeb検索・写真検索", url: "https://search.brave.com/", linkLabel: "提供元" },
    { name: "Wikipedia / Wikimedia Commons", purpose: "観光情報・写真", url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use", linkLabel: "利用条件" },
    { name: "観光庁 多言語解説文データベース", purpose: "地域の観光資源の解説資料", url: "https://www.mlit.go.jp/tagengo-db/", linkLabel: "資料の出典" },
    { name: "農林水産省 うちの郷土料理", purpose: "郷土料理・食文化の参考資料", url: "https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/", linkLabel: "資料の出典" },
    { name: accommodation.displayName, purpose: "宿泊施設・写真・評価・参考料金", url: accommodation.creditUrl, linkLabel: accommodation.creditAlt, imageUrl: accommodation.creditImageUrl, imageAlt: accommodation.creditAlt },
    { name: "ホットペッパーグルメ Webサービス", purpose: "飲食店候補", url: "https://webservice.recruit.co.jp/", linkLabel: "ホットペッパーグルメ Webサービス", imageUrl: "https://webservice.recruit.co.jp/banner/hotpepper-s.gif", imageAlt: "ホットペッパーグルメ Webサービス" },
    { name: "Open-Meteo", purpose: "天気予報", url: "https://open-meteo.com/", linkLabel: "提供元" },
    { name: "気象庁", purpose: "警報・防災情報", url: "https://xml.kishou.go.jp/", linkLabel: "気象庁防災情報XML" },
    { name: "Amazon Bedrock", purpose: "AIによる旅行相談", url: "https://aws.amazon.com/bedrock/", linkLabel: "提供元" },
    { name: "Amazon Cognito", purpose: "ログイン・アカウント認証", url: "https://aws.amazon.com/cognito/", linkLabel: "提供元" },
  ];
  const document = list.ownerDocument;
  list.className = "external-service-list";
  list.replaceChildren(...services.map(service => {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = service.name;
    const purpose = document.createElement("span");
    purpose.textContent = service.purpose;
    const link = document.createElement("a");
    link.href = service.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = service.linkLabel;
    if (service.imageUrl) {
      const image = document.createElement("img");
      image.src = service.imageUrl;
      image.alt = service.imageAlt ?? service.name;
      image.loading = "lazy";
      image.addEventListener("error", () => { link.textContent = service.linkLabel; });
      link.replaceChildren(image);
    }
    row.append(name, purpose, link);
    return row;
  }));
}
