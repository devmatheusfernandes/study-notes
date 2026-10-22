"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updatePassword, type AuthState } from "../login/actions";

const initialState: AuthState = undefined;

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <div
      className="w-full max-w-[560px] overflow-hidden rounded-3xl border border-border bg-card"
      style={{
        background: "radial-gradient(120% 90% at 12% 0%, var(--surface) 0%, var(--card) 62%)",
      }}
    >
      <div className="flex flex-col items-start gap-6 p-10 sm:p-14">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl leading-[1.1] tracking-tight">Nova senha</h1>
          <p className="max-w-[34ch] text-sm text-muted-foreground text-pretty">
            Escolha a nova senha da sua conta.
          </p>
        </div>

        <form action={action} className="flex w-full flex-col gap-3.5">
          <Field label="Nova senha">
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </Field>

          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" size="lg" fullWidth disabled={pending} isLoading={pending}>
            Salvar senha
          </Button>
        </form>
      </div>
    </div>
  );
}
