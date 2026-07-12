import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // jsdom has no reliable EventSource; force App onto its fetch/poll fallback.
  delete window.EventSource;
  // jsdom does not implement matchMedia (used by the decorative background).
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
