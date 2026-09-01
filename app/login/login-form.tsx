"use client";

import { useActionState, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signIn, signUp, type AuthState } from "./actions";

type Mode = "signin" | "signup";

const initialState: AuthState = undefined;

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [signInState, signInAction, signInPending] = useActionState(signIn, initialState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);

  const isSignIn = mode === "signin";
  const state = isSignIn ? signInState : signUpState;
  const action = isSignIn ? signInAction : signUpAction;
  const pending = isSignIn ? signInPending : signUpPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-[560px] rounded-3xl border border-border bg-card overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 90% at 12% 0%, var(--surface) 0%, var(--card) 62%)",
      }}
    >
      <div className="flex flex-col items-start gap-6 p-10 sm:p-14">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex items-center gap-2.5"
        >
          <div className="size-6.5 rounded-full bg-primary" />
          <span className="font-heading text-lg tracking-tight">Study Notes</span>
        </motion.div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: isSignIn ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isSignIn ? 12 : -12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex w-full flex-col gap-6"
          >
            <div className="flex flex-col gap-1.5">
              <h1 className="font-heading text-3xl leading-[1.1] tracking-tight">
                {isSignIn ? "Bem-vindo de volta" : "Crie sua conta"}
              </h1>
              <p className="max-w-[34ch] text-sm text-muted-foreground text-pretty">
                {isSignIn
                  ? "Suas notas continuam funcionando offline. A sincronização acontece quando houver conexão."
                  : "Leva menos de um minuto. Suas notas ficam disponíveis offline, sempre."}
              </p>
            </div>

            <form action={action} className="flex w-full flex-col gap-3.5">
              <Field label="E-mail">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                />
              </Field>

              <Field label="Senha">
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={isSignIn ? undefined : 6}
                    autoComplete={isSignIn ? "current-password" : "new-password"}
                    placeholder="••••••••"
                    className="pr-24 tracking-[0.22em] placeholder:tracking-normal"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1 font-mono text-[11px] font-medium text-accent"
                  >
                    {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showPassword ? "ocultar" : "mostrar"}
                  </button>
                </div>
              </Field>

              {isSignIn && (
                <a href="#" className="self-end text-xs text-accent hover:text-accent/80">
                  Esqueci minha senha
                </a>
              )}

              <AnimatePresence mode="wait">
                {state?.error && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Alert variant="destructive">
                      <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
                {state?.message && (
                  <motion.div
                    key="message"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Alert variant="success">
                      <AlertDescription>{state.message}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button type="submit" size="lg" fullWidth disabled={pending} isLoading={pending}>
                {isSignIn ? "Entrar" : "Criar conta"}
              </Button>
            </form>

            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              {isSignIn ? "Ainda não tem conta?" : "Já tem uma conta?"}
              <Button
                type="button"
                variant="link"
                onClick={() => setMode(isSignIn ? "signup" : "signin")}
              >
                {isSignIn ? "Criar conta" : "Entrar"}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
