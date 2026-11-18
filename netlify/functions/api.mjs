import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

// Login: credentials live in Netlify env vars APP_USER / APP_PASS (never in the repo).
const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]) || "";
const COOKIE = "vts";
const DAYS = 30;
const sign = (exp) => createHmac("sha256", env("SESSION_SECRET") || env("APP_PASS")).update(`${exp}|${env("APP_USER")}|${env("APP_PASS")}`).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
function readCookie(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)vts=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function authed(req) {
  const [exp, sig] = readCookie(req).split(".");
  return !!exp && !!sig && +exp > Date.now() && same(sig, sign(exp));
}
const cookieHeader = (val, maxAge) => `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const PEOPLE = ["Amey", "Daksha", "Tejas", "Karishma", "Aai", "Baba", "Dipti", "Vaibhav", "Yudhan"];
const ADULTS = PEOPLE.filter((p) => p !== "Yudhan");
const ALL = ADULTS.slice();
const without = (...x) => ADULTS.filter((p) => !x.includes(p));

const SEED = {
  rate: 273.77,
  expenses: [
    { id: "e01", date: "2026-11-13", desc: "Lunch", payer: "Tejas", cur: "INR", amount: 3021.2, mode: "equal", people: ALL },
    { id: "e02", date: "2026-11-13", desc: "Dinner – Maazi Duong Thanh", payer: "Tejas", cur: "INR", amount: 5087.67, mode: "equal", people: without("Vaibhav") },
    { id: "e03", date: "2026-11-15", desc: "Lunch – Noi Bai airport", payer: "Tejas", cur: "INR", amount: 5199.53, mode: "equal", people: ALL },
    { id: "e04", date: "2026-11-15", desc: "Dinner – Indian Ganga, Da Nang", payer: "Tejas", cur: "INR", amount: 7355.5, mode: "equal", people: ALL },
    { id: "e05", date: "2026-11-16", desc: "Dinner – Indian restaurant", payer: "Tejas", cur: "INR", amount: 4560.28, mode: "equal", people: without("Karishma") },
    { id: "e06", date: "2026-11-17", desc: "Lunch", payer: "Tejas", cur: "INR", amount: 6707, mode: "equal", people: ALL },
    { id: "e07", date: "2026-11-17", desc: "Dinner – Lifestyle", payer: "Tejas", cur: "INR", amount: 6568.2, mode: "equal", people: ALL },
    { id: "e08", date: "2026-11-17", desc: "Kaki Spa", payer: "Tejas", cur: "VND", amount: 3700000, inr: 13515.24, mode: "custom", people: ALL,
      custom: { Amey: 450000, Aai: 490000, Baba: 490000, Karishma: 490000, Daksha: 490000, Dipti: 490000, Tejas: 400000, Vaibhav: 400000 } },
    { id: "e09", date: "2026-11-18", desc: "Dinner – Banana Leaf, HCMC", payer: "Tejas", cur: "INR", amount: 3159.63, mode: "equal", people: without("Amey", "Vaibhav") },
  ],
};

const store = () => getStore({ name: "trip", consistency: "strong" });
const json = (b, s = 200) => Response.json(b, { status: s, headers: { "cache-control": "no-store" } });
const num = (v) => (Number.isFinite(+v) ? +v : 0);

async function seedIfNeeded(s) {
  // "settings" is written last, so its presence means seeding finished.
  if (await s.get("settings")) return;
  for (const e of SEED.expenses) {
    const { id, ...body } = e;
    if (!(await s.get("expenses/" + id))) await s.setJSON("expenses/" + id, body);
  }
  await s.setJSON("settings", { rate: SEED.rate });
}

async function log(s, entry) {
  const at = new Date().toISOString();
  await s.setJSON(`log/${at}-${Math.random().toString(36).slice(2, 7)}`, { ...entry, at });
}
const fmtAmt = (e) => (e.cur === "VND" ? `${Math.round(e.amount).toLocaleString("en-US")} ₫` : `₹${(+e.amount).toLocaleString("en-IN")}`);

function clean(b) {
  const people = Array.isArray(b.people) ? b.people.filter((p) => PEOPLE.includes(p)) : [];
  const custom = {};
  if (b.custom && typeof b.custom === "object")
    for (const p of PEOPLE) if (num(b.custom[p]) > 0) custom[p] = num(b.custom[p]);
  return {
    date: String(b.date || "").slice(0, 10),
    desc: String(b.desc || "Expense").slice(0, 120),
    payer: PEOPLE.includes(b.payer) ? b.payer : "Tejas",
    cur: b.cur === "VND" ? "VND" : "INR",
    amount: num(b.amount),
    inr: num(b.inr) || "",
    mode: b.mode === "custom" ? "custom" : "equal",
    people,
    custom,
    updatedAt: new Date().toISOString(),
  };
}

export default async (req) => {
  const s = store();
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  try {
    if (!env("APP_USER") || !env("APP_PASS")) return json({ error: "Login is not configured on the server" }, 500);
    if (req.method === "POST" && parts[0] === "login") {
      const { user, pass } = await req.json().catch(() => ({}));
      if (!same(user || "", env("APP_USER")) || !same(pass || "", env("APP_PASS"))) {
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: "Wrong username or password" }, 401);
      }
      const exp = String(Date.now() + DAYS * 864e5);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cookieHeader(`${exp}.${sign(exp)}`, DAYS * 86400) },
      });
    }
    if (req.method === "POST" && parts[0] === "logout") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": cookieHeader("", 0) } });
    }
    if (!authed(req)) return json({ error: "Please sign in" }, 401);
    const by = PEOPLE.includes(req.headers.get("x-who")) ? req.headers.get("x-who") : "";
    if (req.method === "GET" && parts[0] === "state") {
      await seedIfNeeded(s);
      const settings = (await s.get("settings", { type: "json" })) || { rate: SEED.rate };
      const { blobs } = await s.list({ prefix: "expenses/" });
      const expenses = (
        await Promise.all(blobs.map(async (b) => {
          const d = await s.get(b.key, { type: "json" });
          return d ? { ...d, id: b.key.slice(9) } : null;
        }))
      ).filter(Boolean);
      const logKeys = (await s.list({ prefix: "log/" })).blobs.map((b) => b.key).sort().reverse().slice(0, 20);
      const changes = (await Promise.all(logKeys.map((k) => s.get(k, { type: "json" })))).filter(Boolean);
      return json({ rate: settings.rate, expenses, changes });
    }
    if (parts[0] === "expenses" && parts[1] && /^[A-Za-z0-9_-]{1,40}$/.test(parts[1])) {
      const key = "expenses/" + parts[1];
      if (req.method === "PUT") {
        const body = clean(await req.json());
        if (!body.amount) return json({ error: "Amount required" }, 400);
        const prev = await s.get(key, { type: "json" });
        await s.setJSON(key, body);
        await log(s, { action: prev ? "edited" : "added", desc: body.desc, amount: fmtAmt(body), date: body.date, by });
        return json({ ok: true });
      }
      if (req.method === "DELETE") {
        const prev = await s.get(key, { type: "json" });
        await s.delete(key);
        if (prev) await log(s, { action: "deleted", desc: prev.desc, amount: fmtAmt(prev), date: prev.date, by });
        return json({ ok: true });
      }
    }
    if (req.method === "PUT" && parts[0] === "rate") {
      const { rate } = await req.json();
      if (!(num(rate) > 0)) return json({ error: "Bad rate" }, 400);
      await s.setJSON("settings", { rate: num(rate) });
      await log(s, { action: "rate", desc: `VND rate set to ${num(rate)} ₫/₹`, by });
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
};

export const config = { path: "/api/*" };
