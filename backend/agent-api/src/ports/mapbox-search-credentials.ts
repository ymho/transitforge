export interface MapboxSearchCredentials {
  accessToken: string;
}

export interface MapboxSearchCredentialsRepository {
  load(): Promise<MapboxSearchCredentials | undefined>;
}
