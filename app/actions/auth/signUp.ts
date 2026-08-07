"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { signupSchema, type SignupInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { verifyInviteToken } from "@/lib/auth/invite-token";

// Só o path exato de accept-invite, com token no formato <body>.<sig> — não é
// um "next" genérico (esse fluxo não passa por revisão de open-redirect).
const ACCEPT_INVITE_NEXT = /^\/team\/accept-invite\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Extrai o token de convite de um `next` vindo do form de signup, e só o
 * devolve se ainda for válido (assinatura + expiração) E o e-mail bater com o
 * que a pessoa está cadastrando — caso contrário ela cairia em
 * /team/accept-invite com "email não corresponde" logo após criar a própria
 * conta, o que é mais confuso que simplesmente ignorar o convite aqui.
 */
function tokenDoConviteSeValido(next: string | undefined, email: string): string | null {
  if (!next) return null;
  const m = ACCEPT_INVITE_NEXT.exec(next);
  if (!m) return null;
  const token = m[1]!;
  const payload = verifyInviteToken(token);
  if (!payload) return null;
  if (payload.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return token;
}

export type SignUpResult =
  | { ok: true }
  | {
      ok: false;
      error: "validation_error" | "rate_limited" | "signup_failed";
      details?: Record<string, unknown>;
    };

/**
 * Signup self-service: cria o usuário no GoTrue e dispara o e-mail de
 * confirmação. O tenant só é provisionado quando o link é confirmado em
 * /auth/confirm (evita orgs órfãs de cadastros nunca confirmados).
 *
 * Anti-enumeração: e-mail já cadastrado recebe a MESMA resposta de sucesso —
 * o GoTrue devolve um usuário ofuscado (identities vazio) sem erro, e nós não
 * diferenciamos. Rate limit de envio de e-mail é do próprio GoTrue.
 */
export async function signUp(input: SignupInput, next?: string): Promise<SignUpResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Criar conta é fluxo raro por pessoa: teto baixo por IP evita fábrica de
  // organizações (cada signup provisiona tenant). Issue #64.
  if (await authRateLimited("signup", null, AUTH_LIMITS.signup)) {
    return { ok: false, error: "rate_limited" };
  }

  // Quem chegou aqui a partir de um link de convite (ex.: clicou "Criar
  // conta" na tela de aceite) não deve ganhar uma organização nova ao
  // confirmar o e-mail — /auth/confirm lê este metadata e pula o
  // provisionamento automático, mandando direto para aceitar o convite.
  const inviteToken = tokenDoConviteSeValido(next, parsed.data.email);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      data: {
        org_name: parsed.data.org_name,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    },
  });

  if (error) {
    if (error.status === 429) return { ok: false, error: "rate_limited" };
    await audit({
      action: "auth.signup_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error.message,
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "signup_failed" };
  }

  await audit({
    action: "auth.signup_requested",
    actorUserId: data.user?.id ?? null,
    metadata: { email_hash: hashEmail(parsed.data.email) },
    requestId,
    ip,
    userAgent,
  });

  return { ok: true };
}
