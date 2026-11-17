import { expect, it } from "vitest";
import { verifyLineIdentity } from "../supabase/functions/_shared/line-auth";
const claims = {
  sub: "synthetic-line",
  aud: "synthetic-channel",
  iss: "https://access.line.me",
  exp: Math.floor(Date.now() / 1000) + 600,
};
function verifier(overrides: Record<string, unknown> = {}, status = 200) {
  return (async (_input, init) => {
    expect(String(init?.body)).toContain("client_id=synthetic-channel");
    return Response.json({ ...claims, ...overrides }, { status });
  }) as typeof fetch;
}
it("uses the identity returned by LINE verification, never a client supplied user ID", async () => {
  expect(await verifyLineIdentity("id-token", "synthetic-channel", verifier()))
    .toBe("synthetic-line");
});
it("rejects missing, forged, wrong-channel, wrong-issuer and expired LINE tokens", async () => {
  await expect(verifyLineIdentity(null, "synthetic-channel", verifier()))
    .rejects.toThrow();
  for (
    const change of [
      { aud: "other" },
      { iss: "https://example.test" },
      { exp: 1 },
      { sub: "" },
      { exp: "9999999999" },
    ]
  ) {
    await expect(
      verifyLineIdentity("id-token", "synthetic-channel", verifier(change)),
    ).rejects.toThrow();
  }
  await expect(
    verifyLineIdentity("forged", "synthetic-channel", verifier({}, 400)),
  ).rejects.toThrow();
});
