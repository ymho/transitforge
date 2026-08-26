import type { StationCoordinate } from "@raiquora/train/station";

export interface BrowserGeolocation {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    error?: (error: GeolocationPositionError) => void,
    options?: PositionOptions,
  ): void;
}

export function currentBrowserCoordinate(
  geolocation: BrowserGeolocation | undefined = globalThis.navigator?.geolocation,
): Promise<StationCoordinate> {
  if (!geolocation) {
    return Promise.reject(
      new Error("この端末では現在地を取得できません。出発駅を入力してください。"),
    );
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => resolve([
        position.coords.longitude,
        position.coords.latitude,
      ]),
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "現在地の利用が許可されていません。出発駅を入力するか、位置情報を許可してください。"
          : "現在地を取得できませんでした。出発駅を入力してください。";
        reject(new Error(message));
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 5 * 60_000,
      },
    );
  });
}
