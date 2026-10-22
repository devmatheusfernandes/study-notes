"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

async function getOrigin() {
  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export type AuthState = {
  error?: string;
  message?: string;
} | undefined;

function authErrorMessage(
  error: { code?: string; status?: number },
  fallback: string,
) {
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.";
  }
  if (error.code === "user_already_exists") {
    return "Já existe uma conta com esse e-mail. Tente entrar ou recuperar a senha.";
  }
  if (error.code === "weak_password") {
    return "Senha fraca demais. Escolha uma senha mais difícil de adivinhar.";
  }
  if (error.code === "email_address_invalid") {
    return "Esse e-mail não é válido.";
  }
  return fallback;
}

export async function signIn(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "E-mail ou senha incorretos." };
  }

  redirect("/notes");
}

export async function signUp(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (password.length < 6) {
    return { error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await getOrigin()}/auth/callback` },
  });

  if (error) {
    console.error("[signUp]", error.code, error.message);
    return { error: authErrorMessage(error, "Não foi possível criar sua conta. Tente novamente.") };
  }

  if (!data.session) {
    return { message: "Quase lá! Confirme sua conta pelo link que enviamos ao seu e-mail." };
  }

  redirect("/notes");
}

export async function requestPasswordReset(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Informe o e-mail da sua conta." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await getOrigin()}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error("[requestPasswordReset]", error.code, error.message);
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: authErrorMessage(error, "") };
    }
    // Never reveal whether the address exists; other failures look like success.
  }

  return {
    message: "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.",
  };
}

export async function updatePassword(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) {
    return { error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { error: "O link expirou. Peça um novo em “Esqueci minha senha”." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[updatePassword]", error.code, error.message);
    return { error: authErrorMessage(error, "Não foi possível alterar a senha. Tente novamente.") };
  }

  redirect("/notes");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
