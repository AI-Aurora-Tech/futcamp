-- ===========================================================================
-- Tabelaço — colunas da fila de WhatsApp no formato `send-whatsapp`
--
-- A 0042 grava a fila com (target_teams, message, category_id), mas nenhuma
-- migration do repositório cria essas colunas — elas vieram de uma migration
-- da `send-whatsapp` que ficou fora do repositório. Num banco novo, o gatilho
-- de partida marcada/encerrada falhava ("column message does not exist") e
-- SALVAR A PARTIDA dava erro.
--
-- Também solta o NOT NULL de to_phone/body (formato da 0041): a 0042 não os
-- preenche mais.
--
-- Idempotente: num banco que já tem as colunas, não muda nada.
-- ===========================================================================

alter table public.whatsapp_outbox add column if not exists target_teams uuid[];
alter table public.whatsapp_outbox add column if not exists message      text;
alter table public.whatsapp_outbox add column if not exists category_id  text;

alter table public.whatsapp_outbox alter column to_phone drop not null;
alter table public.whatsapp_outbox alter column body     drop not null;
