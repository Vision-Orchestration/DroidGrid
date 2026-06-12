import type { Request, Response } from "express";

export function mockReq(
  body: unknown = {},
  headers: Record<string, string> = {},
  ip = "127.0.0.1",
): Request {
  return { body, headers, ip, path: "/api/test" } as any;
}

export function mockRes(): Response & { body: unknown; statusCode: number } {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
  };
  return res;
}
