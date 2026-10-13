import { iconMarkup } from "../shared/primitives";

/** Editorial content only: selecting a theme starts a consultation, never an adopted itinerary.
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
  { id: "highland", title: "山と湖、深呼吸の休日", description: "自然のそばで過ごす、ゆるやかな一日。", image: "/media/home-highland.webp",
    prompt: "長野や滋賀で、山や湖の景色を楽しむ旅を考えたい。無理なく歩ける場所と行き方を相談したいです。" },
  { id: "night", title: "夕暮れから、港町へ", description: "夜景とごはんを楽しむ、大人の街歩き。", image: "/media/home-harbor-night.webp",
    prompt: "神戸や横浜の港町で、夜景と食事を楽しむ旅を考えたい。日程や移動、立ち寄る場所を相談したいです。" },
  { id: "cafe", title: "カフェから始まる街歩き", description: "気になる一杯を、旅のきっかけに。", image: "/media/home-cafe.webp",
    prompt: "京都や金沢で、カフェと古いまちなみを楽しむ旅を考えたい。出発地や日程も含めて相談したいです。" },
];
const campaigns: readonly (HomeTheme & { label: string })[] = [
  { id: "autumn", label: "AUTUMN ESCAPE", title: "秋色を探す、週末。", description: "紅葉と、小さな寄り道。", image: "/media/home-autumn.webp",
    prompt: "関西で紅葉と街歩きを楽しむ旅を考えたい。見頃を確認しながら、行き先と日程を相談したいです。" },
  { id: "rail", label: "RAIL & SEA", title: "次の駅で、海に会う。", description: "車窓も旅の目的に。", image: "/media/home-coastal-train.webp",
    prompt: "瀬戸内や紀伊半島で、海の景色を楽しめる列車旅を考えたい。出発地や日程、途中で降りる場所を相談したいです。" },
  { id: "winter", label: "SLOW WINTER", title: "静けさを、旅の目的に。", description: "雪景色と、あたたかな時間。", image: "/media/home-snow.webp",
    prompt: "長野や北陸で、雪景色と温泉を楽しむ冬の旅を考えたい。無理のない移動と日程を相談したいです。" },
];

export function configureHomeDiscovery(topics: HTMLElement, services: HTMLElement, ports: {
  now(): Date; choosePrompt(prompt: string): Promise<void>; trips(): void; map(): void;
}, content: readonly HomeTheme[] = themes, promotions = campaigns) {
  const doc = topics.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const result = doc.createElement(tag); result.className = className; if (text) result.textContent = text; return result;
  };
  topics.className = "home-discovery";
  const heading = node("h2", "", "次の旅のヒント"), copy = node("p", "home-section-copy", "気になるテーマから、相談を始めてみませんか。"), cards = node("div", "home-theme-grid");
  const banners = node("div", "home-campaign-grid"); banners.setAttribute("role", "region"); banners.setAttribute("aria-label", "KAIHOの旅行特集");
  topics.append(banners, heading, copy, cards);
  let selecting = false;
  const select = async (prompt: string) => {
    if (selecting) return;
    selecting = true;
    topics.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
    try { await ports.choosePrompt(prompt); }
    finally { selecting = false; topics.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; }); }
  };
  const refresh = () => {
    const now = ports.now().getTime();
    const isPublished = (item: HomeTheme) => (!item.from || Date.parse(item.from) <= now) && (!item.until || now < Date.parse(item.until));
    const published = content.filter(isPublished), advertised = promotions.filter(isPublished);
    topics.hidden = !published.length && !advertised.length; cards.replaceChildren(); banners.replaceChildren();
    heading.hidden = copy.hidden = cards.hidden = !published.length; banners.hidden = !advertised.length;
    for (const item of advertised) {
      const button = node("button", "home-campaign"); button.type = "button"; button.dataset.homeCampaign = item.id; button.disabled = selecting;
      const image = node("img", ""); image.src = item.image; image.alt = ""; image.loading = "lazy"; image.width = 1200; image.height = 800;
      const body = node("span", "home-campaign-copy");
      body.append(node("small", "home-campaign-label", `KAIHO 特集 / ${item.label}`), node("strong", "", item.title), node("span", "", item.description), node("small", "home-campaign-link", "この旅を相談する"));
      button.append(image, body); button.addEventListener("click", () => { void select(item.prompt); }); banners.append(button);
    }
    for (const item of published) {
      const button = node("button", "home-theme-card"); button.type = "button"; button.dataset.homeTheme = item.id; button.disabled = selecting;
      const media = node("span", "home-theme-media"), image = node("img", ""), body = node("span", "home-theme-copy");
      image.src = item.image; image.alt = ""; image.loading = "lazy";
      media.append(image);
      const title = node("strong", "", item.title), description = node("span", "", item.description), link = node("small", "", "このテーマで相談する");
      body.append(title, description, link); button.append(media, body);
      button.addEventListener("click", () => { void select(item.prompt); }); cards.append(button);
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
