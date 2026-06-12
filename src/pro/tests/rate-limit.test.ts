import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../src-server/rate-limit.js";
import { mockReq, mockRes } from "./helpers.js";

describe("createRateLimiter", () => {
  it("allows requests within the limit", () => {
    let now = 100_000;
    const limiter = createRateLimiter({
      maxTokens: 5,
      windowMs: 60_000,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) {
      const req = mockReq({}, {}, "192.168.1.1");
      const res = mockRes();
      const blocked = limiter.rateLimit(req, res);
      expect(blocked).toBe(false);
    }
  });

  it("blocks requests exceeding the limit", () => {
    let now = 100_000;
    const limiter = createRateLimiter({
      maxTokens: 3,
      windowMs: 60_000,
      now: () => now,
    });
    for (let i = 0; i < 3; i++) {
      const req = mockReq({}, {}, "192.168.1.2");
      const res = mockRes();
      expect(limiter.rateLimit(req, res)).toBe(false);
    }
    const req = mockReq({}, {}, "192.168.1.2");
    const res = mockRes();
    expect(limiter.rateLimit(req, res)).toBe(true);
    expect(res.statusCode).toBe(429);
  });

  it("refills tokens after window passes", () => {
    let now = 100_000;
    const limiter = createRateLimiter({
      maxTokens: 2,
      windowMs: 60_000,
      now: () => now,
    });
    const ip = "192.168.1.3";
    expect(limiter.rateLimit(mockReq({}, {}, ip), mockRes())).toBe(false);
    expect(limiter.rateLimit(mockReq({}, {}, ip), mockRes())).toBe(false);
    expect(limiter.rateLimit(mockReq({}, {}, ip), mockRes())).toBe(true);

    now += 60_001;
    expect(limiter.rateLimit(mockReq({}, {}, ip), mockRes())).toBe(false);
  });

  it("tracks separate IPs independently", () => {
    let now = 100_000;
    const limiter = createRateLimiter({
      maxTokens: 1,
      windowMs: 60_000,
      now: () => now,
    });
    expect(limiter.rateLimit(mockReq({}, {}, "10.0.0.1"), mockRes())).toBe(false);
    expect(limiter.rateLimit(mockReq({}, {}, "10.0.0.2"), mockRes())).toBe(false);
    expect(limiter.rateLimit(mockReq({}, {}, "10.0.0.1"), mockRes())).toBe(true);
  });

  it("uses x-forwarded-for if present", () => {
    let now = 100_000;
    const limiter = createRateLimiter({
      maxTokens: 1,
      windowMs: 60_000,
      now: () => now,
    });
    const req = mockReq({}, { "x-forwarded-for": "203.0.113.5" });
    expect(limiter.rateLimit(req, mockRes())).toBe(false);
    expect(limiter.rateLimit(req, mockRes())).toBe(true);
  });
});
