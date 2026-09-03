const nonOfficialWebsiteHosts = [
  "mapbox.com", "wikipedia.org", "wikimedia.org", "google.com", "google.co.jp",
  "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com",
  "tripadvisor.", "jalan.net", "rakuten.co.jp", "ikyu.com", "tabelog.com",
  "istockphoto.com", "shutterstock.com",
];

/** Conservative display guard. Unknown aggregators remain hidden unless another source marks them official. */
export function likelyOfficialWebsiteUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    return nonOfficialWebsiteHosts.some((blocked) =>
      hostname === blocked || hostname.includes(blocked))
      ? undefined
      : url.toString();
  } catch {
    return undefined;
  }
}
