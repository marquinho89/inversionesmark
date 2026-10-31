// Función "fondos13f": baja de la SEC (EDGAR) las carteras públicas (formulario 13F) de los grandes fondos y las guarda en la
// tabla config (clave "f13_datos") para que la pantalla "Grandes fondos" las compare con tu cartera.
// La llama el botón ⟳ de esa pantalla (con tu sesión). Si tarda, se puede volver a apretar: lo que ya se resolvió queda guardado.
// Secreto necesario (Edge Functions → Secrets): ALLOWED_EMAIL (el mismo que usa "avisos").
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ALLOWED = (Deno.env.get("ALLOWED_EMAIL") || "").toLowerCase();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UA = `InversionesMark ${ALLOWED || "contacto@example.com"}`;
const T0 = Date.now();
const PRESUPUESTO_MS = 110000; // las funciones gratis cortan a los 150 s

// "nombre" se compara contra el nombre que devuelve la SEC: si el CIK está mal, el fondo se descarta en vez de mostrar otra cosa.
const FONDOS = [
  { id: "brk", nombre: "Berkshire Hathaway (Buffett)", corto: "Berkshire", cik: "1067983", chk: /berkshire/i },
  { id: "psq", nombre: "Pershing Square (Ackman)", corto: "Pershing", cik: "1336528", chk: /pershing/i },
  { id: "him", nombre: "Himalaya Capital (Li Lu)", corto: "Himalaya", cik: "1709323", chk: /himalaya/i },
  { id: "bau", nombre: "Baupost Group (Klarman)", corto: "Baupost", cik: "1061768", chk: /baupost/i },
  { id: "duq", nombre: "Duquesne Family Office (Druckenmiller)", corto: "Duquesne", cik: "1536411", chk: /duquesne/i },
];
const TOP = 60; // posiciones que se guardan por fondo

async function getCfg(key: string) {
  const { data } = await SB.from("config").select("value").eq("key", key).maybeSingle();
  let v = data?.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* queda como texto */ } }
  return v ?? null;
}
async function setCfg(key: string, value: unknown) {
  const { error } = await SB.from("config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error("no se pudo guardar " + key + ": " + error.message);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sec(url: string, texto = false) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!r.ok) throw new Error(`SEC ${r.status} ${url}`);
  return texto ? await r.text() : await r.json();
}

type Pos = { c: string; n: string; v: number; s: number };
const tag = (b: string, t: string) => {
  const m = b.match(new RegExp(`<(?:\\w+:)?${t}>\\s*([^<]*?)\\s*</(?:\\w+:)?${t}>`, "i"));
  return m ? m[1] : "";
};
// Lee la tabla de posiciones de un 13F. Se saltean opciones (put/call) y bonos convertibles: solo acciones/ETF.
function parseTabla(xml: string): Pos[] {
  const agg: Record<string, Pos> = {};
  const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    if (tag(b, "putCall")) continue;
    if (/PRN/i.test(tag(b, "sshPrnamtType"))) continue;
    const c = tag(b, "cusip").toUpperCase();
    const v = parseFloat(tag(b, "value")) || 0;
    const s = parseFloat(tag(b, "sshPrnamt")) || 0;
    if (!c || !(v > 0)) continue;
    const n = tag(b, "nameOfIssuer").replace(/&amp;/g, "&");
    if (!agg[c]) agg[c] = { c, n, v: 0, s: 0 };
    agg[c].v += v;
    agg[c].s += s;
  }
  return Object.values(agg).sort((a, b) => b.v - a.v);
}

async function bajar13F(cik: string, chk: RegExp) {
  const sub: any = await sec(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
  if (!chk.test(String(sub.name || ""))) throw new Error(`el CIK ${cik} es "${sub.name}", no coincide`);
  const rc = sub.filings?.recent || {};
  const idx: number[] = [];
  (rc.form || []).forEach((f: string, i: number) => { if (f === "13F-HR") idx.push(i); });
  if (!idx.length) throw new Error("sin 13F presentados");
  const out: any[] = [];
  for (const i of idx.slice(0, 2)) {
    const acc = String(rc.accessionNumber[i]);
    const dir = `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, "")}`;
    const ind: any = await sec(`${dir}/index.json`);
    const xmls = ((ind.directory?.item || []) as any[]).filter((x) => /\.xml$/i.test(x.name) && !/primary_doc/i.test(x.name));
    xmls.sort((a, b) => (/info|table/i.test(b.name) ? 1 : 0) - (/info|table/i.test(a.name) ? 1 : 0) || (+b.size || 0) - (+a.size || 0));
    if (!xmls.length) throw new Error("no encontré la tabla de posiciones en " + acc);
    const pos = parseTabla(await sec(`${dir}/${xmls[0].name}`, true));
    out.push({ periodo: rc.reportDate[i], presentado: rc.filingDate[i], tot: pos.reduce((a, p) => a + p.v, 0), n: pos.length, pos: pos.slice(0, TOP) });
    await sleep(150);
  }
  return out;
}

// CUSIP → ticker con OpenFIGI (gratis, sin clave: 10 consultas por pedido y ~25 pedidos por minuto)
async function mapear(cusips: string[], cache: Record<string, any>) {
  const pend = cusips.filter((c) => !(c in cache));
  for (let i = 0; i < pend.length; i += 10) {
    if (Date.now() - T0 > PRESUPUESTO_MS) break;
    const lote = pend.slice(i, i + 10);
    try {
      const r = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lote.map((c) => ({ idType: "ID_CUSIP", idValue: c, exchCode: "US" }))),
      });
      if (r.status === 429) { await sleep(6000); i -= 10; continue; }
      if (!r.ok) break;
      const a: any[] = await r.json();
      lote.forEach((c, k) => { const d = a[k]?.data?.[0]; cache[c] = d?.ticker ? { t: String(d.ticker).toUpperCase() } : { t: null }; });
    } catch { break; }
    await sleep(2600);
  }
  return pend.filter((c) => !(c in cache)).length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const tok = req.headers.get("x-user-token") || "";
    const { data } = await SB.auth.getUser(tok);
    if (!data?.user || (data.user.email || "").toLowerCase() !== ALLOWED) return json({ error: "no autorizado" }, 401);

    const previo: any = (await getCfg("f13_datos")) || {};
    const cache: Record<string, any> = ((await getCfg("f13_cusip")) as any) || {};
    const prevF: Record<string, any> = {};
    (previo.fondos || []).forEach((f: any) => { prevF[f.id] = f; });

    const fondos: any[] = [], avisos: string[] = [];
    for (const f of FONDOS) {
      if (Date.now() - T0 > PRESUPUESTO_MS) { if (prevF[f.id]) fondos.push(prevF[f.id]); avisos.push(`${f.corto}: sin tiempo, volvé a apretar ⟳`); continue; }
      try {
        const h = await bajar13F(f.cik, f.chk);
        fondos.push({ id: f.id, nombre: f.nombre, corto: f.corto, cik: f.cik, ...h[0], prev: h[1] || null });
      } catch (e) {
        avisos.push(`${f.corto}: ${(e as Error).message}`);
        if (prevF[f.id]) fondos.push(prevF[f.id]);
      }
    }
    // tickers
    const todos = new Set<string>();
    fondos.forEach((f) => { f.pos.forEach((p: Pos) => todos.add(p.c)); (f.prev?.pos || []).forEach((p: Pos) => todos.add(p.c)); });
    const faltan = await mapear([...todos], cache);
    await setCfg("f13_cusip", cache);
    fondos.forEach((f) => {
      f.pos.forEach((p: any) => { p.t = cache[p.c]?.t ?? null; });
      (f.prev?.pos || []).forEach((p: any) => { p.t = cache[p.c]?.t ?? null; });
    });
    await setCfg("f13_datos", { ts: Date.now(), fondos, avisos });
    return json({ ok: true, fondos: fondos.map((f) => ({ id: f.id, periodo: f.periodo, n: f.n })), sinTicker: faltan, avisos });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
