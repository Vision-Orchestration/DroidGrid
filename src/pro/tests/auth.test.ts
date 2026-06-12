import { describe, it, expect } from "vitest";
import { createAuthModule } from "../src-server/auth.js";
import { mockReq, mockRes } from "./helpers.js";

describe("createAuthModule", () => {
  const TEST_SECRET = "test-secret-for-testing-only";
  const TEST_PASS = "admin123";

  it("signToken produces a three-part JWT", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const token = auth.signToken("admin");
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyToken accepts a valid token", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const token = auth.signToken("admin");
    expect(auth.verifyToken(token)).toBe(true);
  });

  it("verifyToken rejects tampered token", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const token = auth.signToken("admin");
    const parts = token.split(".");
    parts[2] = "tampered";
    expect(auth.verifyToken(parts.join("."))).toBe(false);
  });

  it("verifyToken rejects expired token", () => {
    const auth = createAuthModule({
      secret: TEST_SECRET,
      adminPassword: TEST_PASS,
      tokenTtlSec: -1,
    });
    const token = auth.signToken("admin");
    expect(auth.verifyToken(token)).toBe(false);
  });

  it("authMiddleware passes with valid token", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const token = auth.signToken("admin");
    const req = mockReq({}, { authorization: `Bearer ${token}` });
    Object.defineProperty(req, "path", { value: "/api/cameras" });
    const res = mockRes();
    let called = false;
    auth.authMiddleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it("authMiddleware rejects missing token with 401", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const req = mockReq();
    Object.defineProperty(req, "path", { value: "/api/cameras" });
    const res = mockRes();
    auth.authMiddleware(req, res, () => { throw new Error("should not reach"); });
    expect(res.statusCode).toBe(401);
  });

  it("authMiddleware skips public paths", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const req = mockReq();
    Object.defineProperty(req, "path", { value: "/api/health" });
    const res = mockRes();
    let called = false;
    auth.authMiddleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it("loginHandler rejects wrong password", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const req = mockReq({ password: "wrong" });
    const res = mockRes();
    auth.loginHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("loginHandler accepts correct password", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: TEST_PASS });
    const req = mockReq({ password: TEST_PASS });
    const res = mockRes();
    auth.loginHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).ok).toBe(true);
    expect(typeof (res.body as any).token).toBe("string");
  });

  it("loginHandler returns token when auth disabled", () => {
    const auth = createAuthModule({ secret: TEST_SECRET, adminPassword: "" });
    const req = mockReq();
    const res = mockRes();
    auth.loginHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).note).toBe("auth disabled");
  });
});
