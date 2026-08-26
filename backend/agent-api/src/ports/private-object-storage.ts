export interface PrivateObject {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: "application/json";
  encryption: "AES256";
}

export interface PrivateObjectStorage {
  put(value: PrivateObject): Promise<void>;
}
