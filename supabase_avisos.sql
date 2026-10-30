-- Programación de los avisos push. Correr UNA vez en Supabase → SQL Editor.
-- Antes: Database → Extensions → activar "pg_cron" y "pg_net".
-- Reemplazá TU_CRON_SECRET por el mismo valor que cargaste como secreto CRON_SECRET en la función "avisos".

-- Movimientos grandes + precios objetivo: cada 15 min, lun-vie, 11:00 a 17:59 hora Argentina (la función ignora lo que esté fuera de mercado)
select cron.schedule('avisos-intradia', '*/15 14-20 * * 1-5', $$
  select net.http_post(
    url := 'https://ayeefiagpfpcqudxymvd.supabase.co/functions/v1/avisos?tipo=intradia',
    headers := '{"Content-Type":"application/json","x-cron-secret":"TU_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- Resumen diario: 17:20 hora Argentina, lun-vie
select cron.schedule('avisos-resumen', '20 20 * * 1-5', $$
  select net.http_post(
    url := 'https://ayeefiagpfpcqudxymvd.supabase.co/functions/v1/avisos?tipo=resumen',
    headers := '{"Content-Type":"application/json","x-cron-secret":"TU_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- Para apagarlos: select cron.unschedule('avisos-intradia'); select cron.unschedule('avisos-resumen');
