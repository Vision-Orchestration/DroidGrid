import { useState, useEffect, type ReactNode, type FormEvent } from "react";

const API = "";

export function getToken(): string | null {
  return localStorage.getItem("droidgrid_token");
}

export async function authedFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    localStorage.removeItem("droidgrid_token");
    window.dispatchEvent(new Event("droidgrid:logout"));
  }
  return res;
}

export function LoginGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(!!getToken());
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener("droidgrid:logout", onLogout);
    return () => window.removeEventListener("droidgrid:logout", onLogout);
  }, []);

  if (authed) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.error || "Login failed");
      localStorage.setItem("droidgrid_token", data.token);
      setAuthed(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={submit}
        className="flex w-72 flex-col gap-3 rounded-xl bg-zinc-900 p-6"
      >
        <h1 className="text-lg font-semibold text-zinc-100">DROIDGRIDD</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          autoFocus
          className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-brand"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
