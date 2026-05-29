// Pin the OnboardingState enum to its four implemented values.
//
// rc.3 removed NEEDS_DOCTOR_REVIEW (defined but never emitted by any
// server route and never consumed by the frontend). This test guards
// against future speculative additions: any new enum value must come
// with a server emitter and a frontend consumer.

import { describe, expect, test } from "bun:test";
import { OnboardingState } from "./onboarding";

describe("OnboardingState enum", () => {
  test("contains exactly the four implemented states", () => {
    expect(OnboardingState.options).toEqual(["FIRST_RUN", "NEEDS_USER_MD", "ZERO_AGENTS", "HOME"]);
  });
});
