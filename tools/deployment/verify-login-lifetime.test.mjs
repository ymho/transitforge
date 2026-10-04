import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLoginLifetime } from "./verify-login-lifetime.mjs";

const active = { access: 5, id: 5, refresh: 12, units: { AccessToken: "minutes", IdToken: "minutes", RefreshToken: "hours" } };
test("confirms the AWS readback of twelve-hour refresh with short-lived JWTs", () => {
  assert.equal(verifyLoginLifetime(active), "Login lifetime verified: access=5 minutes; id=5 minutes; refresh=12 hours.\n");
  for (const invalid of [null, {}, { ...active, refresh: 8 }, { ...active, access: 720 },
    { ...active, id: 720 }, { ...active, units: { ...active.units, RefreshToken: "days" } }])
    assert.throws(() => verifyLoginLifetime(invalid));
});
