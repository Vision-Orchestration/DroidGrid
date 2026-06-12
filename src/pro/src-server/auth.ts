import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

interface AuthModuleOptions {
  secret?: string;
  adminPassword?: string;
  tokenTtlSec?: number;
}

interface AuthModule {
  signToken(sub?: string): string;
  verifyToken(token: string): boolean;
  authMiddleware(req: Request, res: Response, next: NextFunction): void;
  loginHandler(req: Request, res: Response): void;
}

export function createAuthModule(options: AuthModuleOptions = {}): AuthModule {
  const SECRET = options.secret ?? randomBytes(32).toString("hex");
  const ADMIN_PASSWORD = options.adminPassword ?? "";
  const TOKEN_TTL_SEC = options.tokenTtlSec ?? 12 * 60 * 60;

  if (typeof process !== "undefined" && !ADMIN_PASSWORD) {
    console.warn(
      "[auth] DROIDGRID_ADMIN_PASSWORD not set — auth DISABLED. " +
      "Set it in the environment to enable login."
    );
  }

  function b64url(buf: Buffer | string): string {
    return Buffer.from(buf).toString("base64url");
  }

  function signToken(sub: string = "admin"): string {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        sub,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
      })
    );
    const sig = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    return `${header}.${payload}.${sig}`;
  }

  function verifyToken(token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts;
    const expected = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    try {
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString()
      );
      if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000)
        return false;
      return true;
    } catch {
      return false;
    }
  }

  const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login"]);

  function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!ADMIN_PASSWORD) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (!req.path.startsWith("/api/")) return next();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !verifyToken(token)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  }

  function loginHandler(req: Request, res: Response) {
    if (!ADMIN_PASSWORD) {
      return res.json({ ok: true, token: signToken("admin"), note: "auth disabled" });
    }
    const { password } = (req.body ?? {}) as { password?: string };
    const supplied = Buffer.from(String(password ?? ""));
    const expected = Buffer.from(ADMIN_PASSWORD);
    const match =
      supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!match) {
      return res.status(401).json({ ok: false, error: "invalid password" });
    }
    res.json({ ok: true, token: signToken("admin") });
  }

  return { signToken, verifyToken, authMiddleware, loginHandler };
}

/** Default production instance */
const defaultModule = createAuthModule({
  secret: process.env.DROIDGRID_JWT_SECRET,
  adminPassword: process.env.DROIDGRID_ADMIN_PASSWORD,
});

export const signToken = defaultModule.signToken;
export const verifyToken = defaultModule.verifyToken;
export const authMiddleware = defaultModule.authMiddleware;
export const loginHandler = defaultModule.loginHandler;
