import { akari } from "./akari";
import { rin } from "./rin";
import { mia } from "./mia";
import { ren } from "./ren";
import { sota } from "./sota";
import { nagi } from "./nagi";
import { koharu } from "./koharu";
import { haruto } from "./haruto";

export const concierges = [
  akari,
  rin,
  mia,
  ren,
  sota,
  nagi,
  koharu,
  haruto
] as const;

export const conciergeById = Object.fromEntries(
  concierges.map((concierge) => [concierge.id, concierge]),
);
