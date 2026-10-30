// Función "avisos": manda notificaciones push a tus dispositivos.
//   ?tipo=intradia  → movimientos grandes del día + precios objetivo (lo llama el cron cada ~15 min con el mercado abierto)
//   ?tipo=resumen   → resumen diario al cierre
//   ?test=1         → aviso de prueba (lo llama el botón 🔔 de la app, con tu sesión)
// Secretos necesarios (Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET, ALLOWED_EMAIL
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ALLOWED = (Deno.env.get("ALLOWED_EMAIL") || "").toLowerCase();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token, x-cron-secret",
};
const MOV_PCT_DEF = 5; // % de variación diaria que dispara el aviso de "movimiento grande"

webpush.setVapidDetails(`mailto:${ALLOWED || "admin@example.com"}`, Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function getCfg(key: string) {
  const { data } = await SB.from("config").select("value").eq("key", key).maybeSingle();
  let v = data?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* queda como texto */ } }
  return v ?? null;
}
async function setCfg(key: string, value: unknown) {
  await SB.from("config").upsert({ key, value }, { onConflict: "key" });
}

// Hora de Buenos Aires
function ahoraAR() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute, dow: p.weekday };
}

type Q = { price: number; chg: number };
// Misma lectura que la app (data912): precio = last/price/close/c/bid; variación = pct_change o contra el cierre previo
function parse912(data: any): Record<string, Q> {
  const out: Record<string, Q> = {};
  const add = (t: string, it: any) => {
    if (!it || typeof it !== "object" || !t) return;
    const price = parseFloat(it.last ?? it.price ?? it.close ?? it.c ?? it.bid ?? 0) || 0;
    if (!(price > 0)) return;
    let chg = 0;
    if (it.pct_change != null) chg = parseFloat(it.pct_change) || 0;
    else {
      const prev = parseFloat(it.prev_close ?? it.prevClose ?? it.previous_close ?? it.pc ?? 0) || 0;
      if (prev > 0) chg = (price / prev - 1) * 100;
    }
    out[String(t).toUpperCase()] = { price, chg };
  };
  if (Array.isArray(data)) data.forEach((it) => add(it.ticker || it.symbol || it.id || it.name, it));
  else if (data && typeof data === "object") Object.keys(data).forEach((t) => add(t, data[t]));
  return out;
}
async function cotizaciones(): Promise<Record<string, Q>> {
  const urls = ["arg_cedears", "arg_stocks", "arg_bonds", "arg_corp", "arg_notes"].map((x) => `https://data912.com/live/${x}`);
  const res = await Promise.all(urls.map((u) => fetch(u, { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : [])).catch(() => [])));
  return Object.assign({}, ...res.map(parse912));
}
async function dolar(casa: string): Promise<number> {
  try { const r = await fetch(`https://dolarapi.com/v1/dolares/${casa}`); const j = await r.json(); return +j.venta || +j.compra || 0; } catch { return 0; }
}

async function enviar(subs: any[], payload: { title: string; body: string; tag?: string; url?: string }) {
  let ok = 0; const muertas: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload)); ok++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) muertas.push(s.endpoint); else console.error("push", e?.statusCode, e?.body); }
  }));
  return { ok, muertas };
}

const n0 = (x: number) => Math.round(x).toLocaleString("es-AR");
const sg = (x: number) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1).replace(".", ",") + "%";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  const test = u.searchParams.get("test") === "1";
  const tipo = u.searchParams.get("tipo") || "intradia";

  // --- autorización ---
  if (test) {
    const tok = req.headers.get("x-user-token") || "";
    const { data } = await SB.auth.getUser(tok);
    if (!data?.user || (data.user.email || "").toLowerCase() !== ALLOWED) return json({ error: "no autorizado" }, 401);
  } else if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "no autorizado" }, 401);
  }

  const subs = ((await getCfg("push_subs")) as any[]) || [];
  if (!Array.isArray(subs) || !subs.length) return json({ enviados: 0, aviso: "no hay dispositivos suscriptos" });
  const url = ((await getCfg("push_watch")) as any)?.url;

  if (test) {
    const r = await enviar(subs, { title: "✅ Avisos activados", body: "Las notificaciones de tu portafolio funcionan.", tag: "test", url });
    if (r.muertas.length) await setCfg("push_subs", subs.filter((s) => !r.muertas.includes(s.endpoint)));
    return json({ enviados: r.ok });
  }

  const watch = (await getCfg("push_watch")) as any;
  if (!watch) return json({ aviso: "la app todavía no publicó datos (abrila una vez)" });
  const ar = ahoraAR();
  if (ar.dow === "Sat" || ar.dow === "Sun") return json({ aviso: "fin de semana" });
  const cfg = ((await getCfg("push_cfg")) as any) || {};
  const movPct = +cfg.movPct > 0 ? +cfg.movPct : MOV_PCT_DEF;
  const estado = ((await getCfg("push_estado")) as any) || {};
  const hoy = estado.fecha === ar.fecha ? estado : { fecha: ar.fecha, enviados: {} as Record<string, boolean> };
  const q = await cotizaciones();
  const avisos: { title: string; body: string; tag: string }[] = [];

  if (tipo === "intradia") {
    if (ar.min < 11 * 60 || ar.min > 17 * 60 + 10) return json({ aviso: "mercado cerrado" });
    // 1) movimientos grandes en lo que tenés
    if (cfg.mov !== false) {
      for (const p of watch.pos || []) {
        const c = q[String(p.t).toUpperCase()]; if (!c) continue;
        const dir = c.chg >= 0 ? "up" : "dn", k = `mov:${p.t}:${dir}`;
        if (Math.abs(c.chg) >= movPct && !hoy.enviados[k]) {
          hoy.enviados[k] = true;
          avisos.push({ title: `${c.chg >= 0 ? "📈" : "📉"} ${p.t} ${sg(c.chg)}`, body: `${p.t} se mueve ${sg(c.chg)} hoy. Tenés ~USD ${n0(p.v)} en este activo.`, tag: k });
        }
      }
    }
    // 2) precios objetivo de compra (Vigilancia): avisa cuando el precio en USD llega o baja del objetivo
    if (cfg.obj !== false && (watch.compras || []).length) {
      const ccl = await dolar("contadoconliqui"), mep = (await dolar("bolsa")) || ccl;
      for (const v of watch.compras) {
        const c = q[String(v.t).toUpperCase()]; if (!c || !(v.obj > 0)) continue;
        const usd = v.k === "usd" ? c.price : v.k === "bono" ? (mep ? c.price / mep : 0) : ccl ? c.price / ccl : 0;
        const k = `obj:${v.t}`;
        if (usd > 0 && usd <= v.obj && !hoy.enviados[k]) {
          hoy.enviados[k] = true;
          avisos.push({ title: `🎯 ${v.t} llegó a tu objetivo`, body: `${v.t} está en USD ${usd.toFixed(2).replace(".", ",")} (objetivo USD ${(+v.obj).toFixed(2).replace(".", ",")}).`, tag: k });
        }
      }
    }
  } else if (tipo === "resumen") {
    if (cfg.resumen === false) return json({ aviso: "resumen desactivado" });
    if (hoy.enviados["resumen"]) return json({ aviso: "ya enviado hoy" });
    let tot = 0, dif = 0; const mv: { t: string; chg: number }[] = [];
    for (const p of watch.pos || []) {
      const c = q[String(p.t).toUpperCase()]; if (!c) continue;
      tot += p.v; dif += p.v * c.chg / 100; mv.push({ t: p.t, chg: c.chg });
    }
    if (tot > 0) {
      mv.sort((a, b) => b.chg - a.chg);
      const top = mv[0], low = mv[mv.length - 1], pct = dif / tot * 100;
      hoy.enviados["resumen"] = true;
      avisos.push({
        title: `${pct >= 0 ? "🟢" : "🔴"} Cartera hoy ${sg(pct)}`,
        body: `≈ ${dif >= 0 ? "+" : "−"}USD ${n0(Math.abs(dif))} sobre ~USD ${n0(tot)}. Mejor: ${top.t} ${sg(top.chg)}. Peor: ${low.t} ${sg(low.chg)}.`,
        tag: "resumen",
      });
    }
  }

  let enviados = 0;
  const muertas = new Set<string>();
  for (const a of avisos) {
    const r = await enviar(subs, { ...a, url });
    enviados += r.ok; r.muertas.forEach((m) => muertas.add(m));
  }
  if (muertas.size) await setCfg("push_subs", subs.filter((s) => !muertas.has(s.endpoint)));
  await setCfg("push_estado", hoy);
  return json({ tipo, avisos: avisos.length, enviados });
});
