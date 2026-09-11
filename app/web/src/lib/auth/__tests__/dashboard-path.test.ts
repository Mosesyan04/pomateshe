import { describe, it, expect } from "vitest";
import { dashboardPathForRole } from "../current-user";

describe("dashboardPathForRole", () => {
  it("maps each role to its own dashboard, never to another role's", () => {
    expect(dashboardPathForRole("teacher")).toBe("/teacher/dashboard");
    expect(dashboardPathForRole("student")).toBe("/student/dashboard");
    expect(dashboardPathForRole("admin")).toBe("/admin/dashboard");
  });
});
