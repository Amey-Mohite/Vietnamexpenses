import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

// Login: credentials live in Netlify env vars APP_USER / APP_PASS (never in the repo).
const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]) || "";
const COOKIE = "vts";
const DAYS = 30;
// Accounts: viewer = APP_USER/APP_PASS; editors = EDITORS env var "Amey:pass,Tejas:pass".
function accounts() {
  const list = [{ user: env("APP_USER"), pass: env("APP_PASS"), role: "view", name: "" }];
  for (const pair of env("EDITORS").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) { const name = pair.slice(0, i).trim(); list.push({ user: name.toLowerCase(), pass: pair.slice(i + 1).trim(), role: "edit", name }); }
  }
  return list.filter((a) => a.user && a.pass);
}
const findAccount = (user) => accounts().find((a) => a.user === String(user || "").trim().toLowerCase()) || accounts().find((a) => a.user === String(user || "").trim());
// Signature covers the account's current password, so changing a password signs that account out.
const sign = (payload, acct) => createHmac("sha256", env("SESSION_SECRET") || env("APP_PASS")).update(`${payload}|${acct.user}|${acct.pass}`).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
function readCookie(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)vts=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function session(req) {
  const [u, exp, sig] = readCookie(req).split(".");
  if (!u || !exp || !sig || !(+exp > Date.now())) return null;
  let user; try { user = Buffer.from(u, "base64url").toString(); } catch { return null; }
  const acct = accounts().find((a) => a.user === user);
  if (!acct || !same(sig, sign(`${u}.${exp}`, acct))) return null;
  return acct;
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
      const acct = findAccount(user);
      if (!acct || !same(pass || "", acct.pass)) {
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: "Wrong username or password" }, 401);
      }
      const u = Buffer.from(acct.user).toString("base64url");
      const payload = `${u}.${Date.now() + DAYS * 864e5}`;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cookieHeader(`${payload}.${sign(payload, acct)}`, DAYS * 86400) },
      });
    }
    if (req.method === "POST" && parts[0] === "logout") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": cookieHeader("", 0) } });
    }
    const me = session(req);
    if (!me) return json({ error: "Please sign in" }, 401);
    const by = me.name;
    if (req.method !== "GET" && me.role !== "edit") return json({ error: "Not allowed" }, 403);
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
      return json({ rate: settings.rate, expenses, changes, canEdit: me.role === "edit", name: me.name });
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
