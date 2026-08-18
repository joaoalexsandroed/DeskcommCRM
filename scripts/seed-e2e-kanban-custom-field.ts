/**
 * Seed E2E custom-field fixture: adiciona 1 campo customizado ("Origem",
 * select) ao schema da pipeline default e preenche `custom_fields` nos 2
 * leads que `seed-e2e-kanban.ts` já cria — um recebe "site", o outro
 * "indicacao". Alimenta o e2e do filtro por campo customizado do Kanban.
 *
 * Idempotente: reescreve o mesmo schema/valores a cada rodada. Depende de
 * .e2e-creds.json com o bloco `kanban` já preenchido (rode
 * scripts/seed-e2e-kanban.ts antes, ou deixe o spec chamá-lo sozinho).
 *
 * Run: npx tsx scripts/seed-e2e-kanban-custom-field.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-kanban-custom-field", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

const FIELD_KEY = "origem_e2e";
const FIELD_LABEL = "Origem";
const OPTION_SITE = { value: "site", label: "Site" };
const OPTION_INDICACAO = { value: "indicacao", label: "Indicação" };

interface Creds {
  org_id: string;
  kanban?: {
    pipeline_id: string;
    owned_lead_id: string;
    unowned_lead_id: string;
  };
  customField?: unknown;
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!creds.kanban) {
    throw new Error("Falta o bloco `kanban` em .e2e-creds.json — rode scripts/seed-e2e-kanban.ts antes.");
  }
  const { pipeline_id: pipelineId, owned_lead_id: ownedId, unowned_lead_id: unownedId } =
    creds.kanban;

  const { data: pipeline, error: pErr } = await admin
    .from("crm_pipelines")
    .select("settings")
    .eq("id", pipelineId)
    .single();
  if (pErr || !pipeline) throw new Error(`pipeline not found: ${pErr?.message}`);

  const existingSettings = ((pipeline as { settings: Record<string, unknown> | null }).settings ??
    {}) as Record<string, unknown>;
  const nextSettings = {
    ...existingSettings,
    fields: [
      {
        key: FIELD_KEY,
        label: FIELD_LABEL,
        type: "select",
        options: [OPTION_SITE, OPTION_INDICACAO],
      },
    ],
  };

  const { error: updatePipelineError } = await admin
    .from("crm_pipelines")
    .update({ settings: nextSettings } as never)
    .eq("id", pipelineId);
  if (updatePipelineError) {
    throw new Error(`update pipeline settings: ${updatePipelineError.message}`);
  }
  console.log(`[seed] pipeline ${pipelineId} settings.fields ganhou "${FIELD_KEY}"`);

  const { error: ownedErr } = await admin
    .from("crm_leads")
    .update({ custom_fields: { [FIELD_KEY]: OPTION_SITE.value } } as never)
    .eq("id", ownedId);
  if (ownedErr) throw new Error(`update owned lead custom_fields: ${ownedErr.message}`);

  const { error: unownedErr } = await admin
    .from("crm_leads")
    .update({ custom_fields: { [FIELD_KEY]: OPTION_INDICACAO.value } } as never)
    .eq("id", unownedId);
  if (unownedErr) throw new Error(`update unowned lead custom_fields: ${unownedErr.message}`);

  console.log(
    `[seed] lead ${ownedId} custom_fields.${FIELD_KEY}=${OPTION_SITE.value}; ` +
      `lead ${unownedId} custom_fields.${FIELD_KEY}=${OPTION_INDICACAO.value}`,
  );

  creds.customField = {
    pipeline_id: pipelineId,
    key: FIELD_KEY,
    label: FIELD_LABEL,
    option_site: OPTION_SITE,
    option_indicacao: OPTION_INDICACAO,
  };
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
  console.log("\n✅ Custom field seed completo.");
}

main().catch((err) => {
  console.error("❌ Custom field seed falhou:", err);
  process.exit(1);
});
