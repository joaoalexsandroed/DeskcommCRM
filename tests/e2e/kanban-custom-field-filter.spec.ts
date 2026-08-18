/**
 * Filtro por campo customizado no board do Kanban (deep-linkável via query
 * param `cf`, um único JSON — ver lib/kanban/filters.ts).
 *
 * Verifica: os dois leads seed aparecem, cada um com um valor diferente do
 * campo customizado "Origem" (select); filtrar por "Site" mostra só o card
 * com esse valor, e "Todos" volta a mostrar os dois. Login como manager (sem
 * MFA; vê todos os leads da org).
 *
 * Pré-requisito: seed de credenciais + seed de kanban + seed de campo
 * customizado (rodados aqui se faltarem).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
  kanban?: { pipeline_id: string };
  customField?: { pipeline_id: string; key: string; label: string };
}

function loadCreds(): Creds {
  const needsBase = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    return !c.users?.manager;
  };
  if (needsBase()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  let c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!c.kanban?.pipeline_id) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-kanban.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  if (!c.customField?.key) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-kanban-custom-field.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  return c;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

test("filtro por campo customizado reflete na URL e isola o lead com o valor escolhido", async ({
  page,
}) => {
  await login(page, creds.users.manager!.email);
  await page.goto(`/app/pipelines/${creds.kanban!.pipeline_id}`);

  const siteLead = page.getByRole("heading", { name: "Pedido E2E com responsavel" });
  const indicacaoLead = page.getByRole("heading", { name: "Pedido E2E sem responsavel" });
  await expect(siteLead).toBeVisible();
  await expect(indicacaoLead).toBeVisible();

  // Abre o filtro do campo customizado "Origem" e escolhe "Site".
  await page.getByRole("button", { name: /^Origem:/ }).click();
  await page.getByRole("menuitem", { name: "Site" }).click();

  await expect(page).toHaveURL(/cf=/);
  await expect(siteLead).toBeVisible();
  await expect(indicacaoLead).toHaveCount(0);

  // Voltar para "Todos" restaura os dois cards.
  await page.getByRole("button", { name: /^Origem:/ }).click();
  await page.getByRole("menuitem", { name: "Todos" }).click();
  await expect(siteLead).toBeVisible();
  await expect(indicacaoLead).toBeVisible();
});
