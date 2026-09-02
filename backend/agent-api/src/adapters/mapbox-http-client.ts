interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export function createMapboxHttpClient(http: FetchPort, viewerOrigin: string): FetchPort {
  const referer = mapboxReferer(viewerOrigin);
  return {
    fetch(input, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("Referer", referer);
      return http.fetch(input, { ...init, headers });
    },
  };
}

function mapboxReferer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("VIEWER_ORIGIN must be a public HTTPS origin");
  }
  return url.origin + "/";
}
