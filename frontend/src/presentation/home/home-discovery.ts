import { iconMarkup } from "../shared/primitives";

/** Editorial content only: a theme fills an unsent prompt, never an itinerary.
 * Slots can be removed, replaced or bounded by publication dates without API changes. */
export interface HomeTheme {
  id: string; title: string; description: string; image: string; prompt: string;
  from?: string; until?: string;
}
const themes: readonly HomeTheme[] = [
  { id: "weekend", title: "週末、海辺のまちへ", description: "瀬戸内の景色と街歩きを楽しむ小旅行。", image: "/media/home-setouchi-v2.webp",
    prompt: "週末に瀬戸内の海辺のまちを歩く旅を考えたい。出発地や日程を相談しながら決めたいです。" },
  { id: "onsen", title: "温泉で、ひと息", description: "街歩きも宿も、自分のペースで。", image: "/media/home-kinosaki-v2.webp",
    prompt: "城崎温泉でゆっくりする旅を考えたい。日程や宿泊先を相談しながら決めたいです。" },
  { id: "culture", title: "歴史にふれる旅", description: "神社や古いまちなみから、行き先を探す。", image: "/media/home-izumo-v2.webp",
    prompt: "神社や古いまちなみを楽しむ旅を考えたい。出雲を候補に、ほかの行き先とも比べたいです。" },
];

export function configureHomeDiscovery(topics: HTMLElement, services: HTMLElement, ports: {
  now(): Date; choosePrompt(prompt: string): Promise<void>; trips(): void; map(): void;
}, content: readonly HomeTheme[] = themes) {
  const doc = topics.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const result = doc.createElement(tag); result.className = className; if (text) result.textContent = text; return result;
  };
  topics.className = "home-discovery";
  const heading = node("h2", "", "次の旅のヒント"), copy = node("p", "home-section-copy", "気になるテーマから、相談を始めてみませんか。"), cards = node("div", "home-theme-grid");
  topics.append(heading, copy, cards);
  const refresh = () => {
    const now = ports.now().getTime();
    const published = content.filter(item => (!item.from || Date.parse(item.from) <= now) && (!item.until || now < Date.parse(item.until)));
    topics.hidden = !published.length; cards.replaceChildren();
    for (const item of published) {
      const button = node("button", "home-theme-card"); button.type = "button"; button.dataset.homeTheme = item.id;
      const media = node("span", "home-theme-media"), image = node("img", ""), body = node("span", "home-theme-copy");
      image.src = item.image; image.alt = ""; image.loading = "lazy";
      media.append(image, node("small", "", "旅のイメージ"));
      const title = node("strong", "", item.title), description = node("span", "", item.description), link = node("small", "", "このテーマで相談する");
      body.append(title, description, link); button.append(media, body);
      button.addEventListener("click", () => { void ports.choosePrompt(item.prompt); }); cards.append(button);
    }
  };
  services.className = "home-services";
  const banner = node("section", "home-service-banner"), text = node("div", "");
  text.append(node("small", "home-section-label", "KAIHOの旅づくり"), node("h2", "", "決まったことも、これからのことも。"), node("p", "", "会話で見つけた候補を旅程へ。予定とチャットを切り替えながら、少しずつ旅を形にできます。"));
  const link = node("button", "ds-button", "旅程を開く"); link.type = "button"; link.addEventListener("click", ports.trips);
  banner.append(text, link);
  const features = node("div", "home-service-links");
  const map = node("button", "home-service-link"); map.type = "button"; map.innerHTML = iconMarkup("train");
  const mapCopy = node("span", ""); mapCopy.append(node("strong", "", "列車の動きを地図で見る"), node("small", "", "時刻表に基づく位置と、取得できた運行情報。"));
  map.append(mapCopy); map.addEventListener("click", ports.map); features.append(map);
  const notices = node("section", "home-notices");
  notices.append(node("h2", "", "ご利用にあたって"), node("p", "", "旅程への追加は予約ではありません。施設の営業・料金・空き状況は、案内に付いた出典や予約先でご確認ください。"));
  services.append(banner, features, notices); refresh();
  const resume = () => { if (!doc.hidden) refresh(); };
  doc.addEventListener("visibilitychange", resume);
  return { refresh, dispose() { doc.removeEventListener("visibilitychange", resume); topics.replaceChildren(); services.replaceChildren(); } };
}
