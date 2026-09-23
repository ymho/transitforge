export interface OutputContractRef {
  name: string;
  version: string;
  schemaHash: string;
}

export interface AgentOutputContract extends OutputContractRef {
  schema: Record<string, unknown>;
  description?: string;
}

/** Stable SHA-256 identity. Kept dependency-free so the shared runtime remains browser-safe. */
export function stableContractHash(value: unknown): string {
  return sha256(new TextEncoder().encode(canonicalJson(value)));
}

function sha256(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength); padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(paddedLength - 4, bitLength >>> 0); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!, y = words[i - 2]!;
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3), s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25), choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + constants[i]! + words[i]!) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22), majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((word, index) => { state[index] = (state[index]! + word) >>> 0; });
  }
  return state.map(word => word.toString(16).padStart(8, "0")).join("");
}

function rotate(value: number, bits: number): number { return (value >>> bits) | (value << (32 - bits)); }

export function outputContract(
  name: string,
  version: string,
  schema: Record<string, unknown>,
  description?: string,
): AgentOutputContract {
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(name)) throw new Error("Output contract name is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(version)) throw new Error("Output contract version is invalid");
  return {
    name,
    version,
    schemaHash: stableContractHash(schema),
    schema: structuredClone(schema),
    ...(description ? { description } : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
