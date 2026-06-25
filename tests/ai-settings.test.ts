import { describe, expect, it } from "vitest";
import { looksLikeRawProviderKey } from "../src/shared/ai-keys";

describe("AI settings key handling", () => {
  it("rejects raw provider-looking keys before they can be saved as BYOK references", () => {
    expect(looksLikeRawProviderKey("sk-proj-not-a-real-key")).toBe(true);
    expect(looksLikeRawProviderKey("sk-live-not-a-real-key")).toBe(true);
    expect(looksLikeRawProviderKey("sk_test_not_a_real_key")).toBe(true);
    expect(looksLikeRawProviderKey(" sess-not-a-real-token ")).toBe(true);
  });

  it("allows gateway aliases and secret references", () => {
    expect(looksLikeRawProviderKey("gateway-key-ref-local-smoke")).toBe(false);
    expect(looksLikeRawProviderKey("cf-aig-byok-friend-openai")).toBe(false);
    expect(looksLikeRawProviderKey("secrets-store:friend-openai")).toBe(false);
  });
});
