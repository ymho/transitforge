import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import type { ShareSecret } from "../ports/trip-authorization.js";
export class CryptographicShareSecret implements ShareSecret {
  id(): string { return randomUUID(); }
  issue() { const secret = randomBytes(32).toString("base64url"); return { secret, hash: this.hash(secret) }; }
  private hash(secret: string): string { return createHash("sha256").update(secret).digest("hex"); }
  verify(secret: string, hash: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || !/^[a-f0-9]{64}$/.test(hash)) return false;
    return timingSafeEqual(Buffer.from(this.hash(secret), "hex"), Buffer.from(hash, "hex"));
  }
}
