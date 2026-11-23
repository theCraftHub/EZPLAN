import { describe, expect, it } from "vitest";
import { inviteProblem, maskEmail, strongest } from "../src/invites";

const base = { email: "sam@example.com", expires_at: 1_000, accepted_by: null, revoked_at: null };

describe("invite rules", () => {
  it("accepts the right person before it expires, and only them", () => {
    expect(inviteProblem(base, 999, "SAM@example.com", "u1")).toBeNull();
    expect(inviteProblem(base, 1_000, "sam@example.com", "u1")).toMatch(/expired/);
    expect(inviteProblem({ ...base, revoked_at: 5 }, 10, "sam@example.com", "u1")).toMatch(/cancelled/);
    expect(inviteProblem({ ...base, accepted_by: "u2" }, 10, "sam@example.com", "u1")).toMatch(/already been used/);
    expect(inviteProblem({ ...base, accepted_by: "u1" }, 5_000, "sam@example.com", "u1")).toBeNull(); // opening it again later is fine
    expect(inviteProblem(base, 10, "kim@example.com", "u3")).toMatch(/This invite is for s•+@example\.com/);
  });
  it("masks addresses and picks the stronger role", () => {
    expect(maskEmail("sam@example.com")).toBe("s••@example.com");
    expect(maskEmail("a@b.co")).toBe("a•@b.co");
    expect(strongest("viewer", "editor")).toBe("editor");
    expect(strongest("manager", "viewer")).toBe("manager");
    expect(strongest(null, "viewer")).toBe("viewer");
  });
});
