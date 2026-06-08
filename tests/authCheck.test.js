import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMetaToken } from "../bin/auth-check.js";

test("checkMetaToken passes when /me returns an id", async () => {
  const fakeFetch = async () => ({ json: async () => ({ id: "123", name: "Me" }) });
  assert.equal((await checkMetaToken({ token: "T", graphVersion: "v21.0", fetchImpl: fakeFetch })).ok, true);
});

test("checkMetaToken fails when /me returns an error", async () => {
  const fakeFetch = async () => ({ json: async () => ({ error: { message: "Invalid OAuth token" } }) });
  const r = await checkMetaToken({ token: "T", graphVersion: "v21.0", fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Invalid OAuth/);
});
