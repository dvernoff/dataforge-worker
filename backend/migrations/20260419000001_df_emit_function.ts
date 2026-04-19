import type { Knex } from 'knex';

/**
 * Creates public.df_emit — a SQL-callable bridge that emits real-time events from *any* source
 * (endpoint, execute_sql_mutation, cron, direct psql session) via pg_notify.
 *
 * The DataForge worker LISTENs on channel 'df_change' and re-broadcasts each notification to
 * WebSocket subscribers (project:<id> and table:<id>:<name>) plus registered webhooks.
 *
 * Because pg_notify is transactional, df_emit calls placed inside a CTE fire only when the
 * enclosing transaction COMMITs — so partial failures never leak ghost events.
 *
 * PostgreSQL enforces an 8000-byte limit per NOTIFY payload. df_emit defensively truncates the
 * optional data blob and annotates the event with `truncated:true` when clipping is necessary.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.df_emit(
      p_table  text,
      p_action text,
      p_pk     text DEFAULT NULL,
      p_data   jsonb DEFAULT NULL
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      v_schema   text := current_schema();
      v_payload  jsonb;
      v_str      text;
      v_max_size int  := 7500;   -- safety margin under PG's 8000-byte NOTIFY limit
    BEGIN
      -- Cheap validation so callers get a sensible error instead of a silent drop.
      IF p_table IS NULL OR length(p_table) = 0 THEN
        RAISE EXCEPTION 'df_emit: p_table must not be empty';
      END IF;
      IF p_action IS NULL OR p_action NOT IN ('INSERT','UPDATE','DELETE','UPSERT') THEN
        RAISE EXCEPTION 'df_emit: p_action must be INSERT, UPDATE, DELETE, or UPSERT (got %)', p_action;
      END IF;

      v_payload := jsonb_build_object(
        's',  v_schema,
        't',  p_table,
        'a',  p_action,
        'ts', extract(epoch from clock_timestamp())::bigint
      );
      IF p_pk IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('pk', p_pk);
      END IF;
      IF p_data IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('d', p_data);
      END IF;

      v_str := v_payload::text;
      IF octet_length(v_str) > v_max_size THEN
        -- Strip the data blob but keep table/action/pk so subscribers can still react
        v_payload := v_payload - 'd' || jsonb_build_object('trunc', true);
        v_str := v_payload::text;
      END IF;

      PERFORM pg_notify('df_change', v_str);
    END;
    $$;
  `);

  // Grant EXECUTE to the worker-app role so projects can SELECT df_emit(...) from custom_sql.
  await knex.raw(`GRANT EXECUTE ON FUNCTION public.df_emit(text, text, text, jsonb) TO PUBLIC`);

  // Comment doubles as in-DB documentation for anyone poking around with \df.
  await knex.raw(`
    COMMENT ON FUNCTION public.df_emit(text, text, text, jsonb) IS
    'DataForge realtime bridge. Call from any SQL (custom_sql endpoints, CTE, triggers) to broadcast a data_change event. Signature: df_emit(table, action, pk, data). action IN (INSERT, UPDATE, DELETE, UPSERT). Payload >7500 bytes is truncated — keep data minimal, use {pk} only if clients can refetch.'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP FUNCTION IF EXISTS public.df_emit(text, text, text, jsonb)`);
}
