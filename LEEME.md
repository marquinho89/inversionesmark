# Portafolio de Marcos — versión 2821 (base v282)

App de seguimiento de inversiones (acciones, Cedears, bonos, ONs y FCI, en pesos y en dólares) que corre en GitHub Pages y guarda los datos en tu propio Supabase.

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `index.html` | Entrada de la app. En la compu abre la cartera; en la app de inicio del celular, la vista mini. |
| `Marcos/PortafolioMarcos.html` | Tu cartera. Acá va tu configuración (URL y clave de Supabase). |
| `Marcos/perfil.svg` | Tu foto (es una "M" provisoria: reemplazala por una imagen tuya con el mismo nombre, o cambiá el `src` en el HTML). |
| `comun/` | El código de la app (`portafolio.js` es lo que se carga, sin minificar). |
| `sw.js`, `manifest.webmanifest`, `app/` | Para instalarla como app en el celular y que abra rápido. |
| `Bull.png`, `Cocos.png`, `Veta.png` | Logos de brokers que usa la Comparación. |
| `supabase.sql` | Las tablas que tiene que tener tu Supabase. |

## Paso 1 — Supabase

1. Entrá a tu proyecto de Supabase → **SQL Editor** → **New query**.
2. Pegá todo el contenido de `supabase.sql` y tocá **Run**.

Se puede correr aunque ya tengas las tablas de la versión anterior: crea lo que falta (por ejemplo la columna `updated_at` o las claves primarias que usa el guardado nuevo) y **no borra tus movimientos**.

Tablas que usa la app:
- `movimientos`: compras, ventas y aportes.
- `trk_divs`: cobros (dividendos, rentas, amortizaciones).
- `config`: todo lo demás (precios objetivo, ratios, tipos de cambio, historial, liquidez, etc.).
- `siri_resumen` + función `siri()`: solo si querés usar "Oye Siri, mi cartera" (opcional).

## Paso 2 — Configurar tu HTML

Abrí `Marcos/PortafolioMarcos.html`, buscá `window.PORTFOLIO_CONFIG` (cerca del final) y completá:

```js
supabaseUrl:'https://TU-PROYECTO.supabase.co',
supabaseKey:'TU-ANON-PUBLIC-KEY',
```

Las dos están en Supabase → **Settings → API** ("Project URL" y "anon public").

Ahí mismo podés ajustar:
- `periodoInicio:'01-01'`: desde qué día del año se mide el rendimiento anual.
- `comisionBonos:0.005`: la comisión de tu broker en bonos.
- `broker:'bull'`: tu broker para la Comparación (`bull`, `cocos` o `veta`).

## Paso 3 — Subirlo a tu repo

1. Reemplazá los archivos de tu repo por los de esta carpeta (si tu HTML tenía otro nombre o carpeta, podés renombrar `Marcos/PortafolioMarcos.html`; `index.html` apunta a ese archivo, cambialo si lo movés).
2. `git add -A && git commit -m "Portafolio v282" && git push`
3. Si todavía no lo tenías: GitHub → tu repo → **Settings → Pages** → Source: `main` / `(root)`.
4. Entrá a `https://TU-USUARIO.github.io/TU-REPO/`. Abajo a la derecha tiene que decir la versión.

Tus datos están en Supabase, así que aparecen solos. La primera vez puede tardar unos segundos más porque no hay nada guardado en el navegador.

## Paso 4 — En el celular (opcional)

Abrí la dirección en Safari (o Chrome) → Compartir → **Agregar a pantalla de inicio**. Desde el ícono abre la **vista mini** (total, hoy, año, avisos y lo que más se movió), con un botón para abrir la cartera completa. En el navegador común también podés agregar `?mini` a la dirección del HTML.

## Paso 5 — Login con Gmail (recomendado, cuando puedas)

Hoy la app funciona **sin login**: cualquiera que tenga la URL y la clave de tu Supabase (la clave queda visible en el HTML publicado) podría leer o cambiar tus datos. Para cerrarlo:

1. Supabase → **Authentication → Providers → Google**: activalo. Te pide un *Client ID* y *Client Secret* de Google Cloud (Google Cloud Console → APIs y servicios → Credenciales → ID de cliente OAuth → Aplicación web; en "URI de redireccionamiento autorizados" va la URL que te muestra Supabase en esa misma pantalla).
2. Supabase → **Authentication → URL Configuration**: en *Site URL* y *Redirect URLs* poné la dirección de tu app en GitHub Pages.
3. En tu HTML: `auth:true, allowedEmail:'tu.mail@gmail.com'`.
4. En el SQL Editor, cerrá el acceso para que solo entre tu mail (cambiá el mail):

```sql
do $$ declare t text; begin
  foreach t in array array['movimientos','trk_divs','config','siri_resumen'] loop
    execute format('drop policy if exists "app: acceso total" on public.%I', t);
    execute format('drop policy if exists "solo yo" on public.%I', t);
    execute format('create policy "solo yo" on public.%I for all to authenticated using ((auth.jwt()->>''email'') = %L) with check ((auth.jwt()->>''email'') = %L)', t, 'tu.mail@gmail.com', 'tu.mail@gmail.com');
  end loop;
end $$;
revoke select, insert, update, delete on public.movimientos, public.trk_divs, public.config, public.siri_resumen from anon;
```

("Oye Siri" sigue funcionando después de esto, porque usa la función `siri()` con tu código secreto.)

## Qué trae esta versión (resumen)

- **Guardado seguro**: una pestaña abierta hace días ya no pisa lo cargado desde otra pestaña o equipo; punto de color al lado de la hora (verde guardado, amarillo pendiente u otra pestaña abierta, rojo error).
- **Tipos de cambio** que se completan solos (MEP y CCL históricos) y ya no se pisan entre pestañas.
- **Comparación con el broker** con un lector nuevo del texto pegado de Bull.
- **📊 Balances**: calendario de presentación de resultados de lo que tenés, y 📊 en el Portafolio si alguno presenta en 4 días.
- **🌙 Modo madrugada**: fuera del horario de mercado no actualiza precios solo.
- **📓 Diario de inversión**: "¿por qué?" al comprar o vender y revisión a los 6 meses.
- **📱 Vista mini** para el celular.
- **DashBoard**: 💯 salud de la cartera (0 a 100 con qué mejorar), 🎬 película de la cartera mes a mes, 📈 línea de tiempo con tus operaciones y los hechos del mercado (último mes, 3M, 1 año, 2 años, total), 🧪 tu plan en piloto automático y 🗣️ "Oye Siri, mi cartera".

## Para actualizar más adelante

Normalmente alcanza con reemplazar los archivos de `comun/` y subir el número `?v=` en la línea `<script src="../comun/portafolio.min.js?v=…">` de tu HTML. Si una versión nueva necesita tablas nuevas, viene con su `supabase.sql`.

## Notas

- Los precios en vivo salen de fuentes públicas (data912, Yahoo, Finnhub, dolarapi, argentinadatos). El historial de precios usa una tabla pública de precios de mercado (solo lectura).
- Las funciones de carteras familiares (vista familiar, sync entre carteras, honorarios) están apagadas en esta copia. Los avisos push están activos: ver `supabase/functions/avisos` y `supabase_avisos.sql`.

## Grandes fondos (13F de la SEC)
La pantalla "Grandes fondos" compara tu cartera de acciones con las carteras públicas de Berkshire, Pershing Square, Himalaya, Baupost y Duquesne.
Para activarla, subí la función `supabase/functions/fondos13f` (Edge Functions → Deploy; usa el secreto `ALLOWED_EMAIL` que ya cargaste para "avisos")
y tocá ⟳ en la pantalla. Si tarda y queda con tickers sin resolver, volvé a tocar ⟳. Los datos se actualizan una vez por trimestre (los fondos presentan hasta 45 días después del cierre).
