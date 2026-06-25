import { describe, expect, it } from "vitest";
import { normalizeEmail, requireUser, userIdForEmail } from "../src/worker/auth";

describe("auth user identity", () => {
  it("uses normalized email ids so providers merge into one beta user", () => {
    expect(normalizeEmail(" Friend@Example.COM ")).toBe("friend@example.com");
    expect(userIdForEmail(" Friend@Example.COM ")).toBe("email:friend@example.com");
  });

  it("allows a localhost test email only when real auth is not configured", async () => {
    const user = await requireUser(
      new Request("http://127.0.0.1/api/me", { headers: { "X-Beachcar-Test-Email": " Friend@Example.com " } }),
      { ALLOWED_EMAIL: "owner@example.com", ENVIRONMENT: "production" } as Env,
    );

    expect(user).toMatchObject({
      id: "email:friend@example.com",
      email: "friend@example.com",
      provider: "local",
    });
  });

  it("does not use local test-email fallback on production hostnames", async () => {
    await expect(
      requireUser(
        new Request("https://beach-car-watch.example.workers.dev/api/me", {
          headers: { "X-Beachcar-Test-Email": "friend@example.com" },
        }),
        { ALLOWED_EMAIL: "owner@example.com", ENVIRONMENT: "production" } as Env,
      ),
    ).rejects.toMatchObject({
      message: "Authentication is not configured",
      status: 403,
    });
  });

  it("does not use local fallback on remote hostnames when environment is missing or development", async () => {
    for (const env of [
      { ALLOWED_EMAIL: "owner@example.com" },
      { ALLOWED_EMAIL: "owner@example.com", ENVIRONMENT: "development" },
    ]) {
      await expect(
        requireUser(
          new Request("https://beach-car-watch.example.workers.dev/api/me", {
            headers: { "X-Beachcar-Test-Email": "friend@example.com" },
          }),
          env as Env,
        ),
      ).rejects.toMatchObject({
        message: "Authentication is not configured",
        status: 403,
      });
    }
  });
});
