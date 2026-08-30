"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { ArrowUpRight, CloudOff, FileStack, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    icon: CloudOff,
    tint: "bg-accent/15 text-accent",
    title: "Offline-first",
    description:
      "Escreva, edite e organize sem depender de conexão. Tudo sincroniza sozinho assim que a rede volta.",
  },
  {
    icon: FileStack,
    tint: "bg-success/15 text-success",
    title: "Tudo em um lugar",
    description:
      "Notas, PDFs, planilhas e outros arquivos convivem nas mesmas pastas — buscáveis e sempre à mão.",
  },
  {
    icon: Sparkles,
    tint: "bg-primary/15 text-primary",
    title: "Assistente com RAG",
    description:
      "Pergunte às suas próprias notas e arquivos. As respostas vêm com a fonte exata, pronta para abrir.",
  },
];

const heroContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6"
      >
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded-full bg-primary" />
          <span className="font-heading text-lg tracking-tight">Study Notes</span>
        </div>
        <Button variant="outline" render={<Link href="/login" />}>
          Entrar
        </Button>
      </motion.header>

      <motion.section
        variants={heroContainer}
        initial="hidden"
        animate="show"
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 pt-16 pb-20 text-center sm:pt-24"
      >
        <motion.div variants={heroItem}>
          <Badge variant="success" className="h-auto gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] font-normal">
            <span className="size-1.5 rounded-full bg-success" />
            Sessão criptografada no dispositivo
          </Badge>
        </motion.div>
        <motion.h1
          variants={heroItem}
          className="font-heading text-4xl leading-[1.12] tracking-tight sm:text-5xl"
        >
          Suas notas continuam funcionando <br className="hidden sm:block" />
          mesmo offline
        </motion.h1>
        <motion.p
          variants={heroItem}
          className="max-w-lg text-base text-muted-foreground text-pretty sm:text-lg"
        >
          Um só lugar para notas, arquivos e conversas de estudo — com sincronização
          automática e um assistente que responde direto das suas fontes.
        </motion.p>
        <motion.div variants={heroItem} className="flex flex-col gap-3 pt-2 sm:flex-row">
          <Button size="lg" render={<Link href="/login" />}>
            Criar conta grátis
          </Button>
          <Button size="lg" variant="outline" rightIcon={<ArrowUpRight />} render={<Link href="/login" />}>
            Já tenho conta
          </Button>
        </motion.div>
      </motion.section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, tint, title, description }, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
              className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-7"
            >
              <div className={`flex size-11 items-center justify-center rounded-2xl ${tint}`}>
                <Icon className="size-5" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-heading text-lg">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                  {description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex flex-col items-center gap-5 rounded-3xl border border-border p-12 text-center"
          style={{
            background:
              "radial-gradient(120% 120% at 50% 0%, var(--surface) 0%, var(--card) 65%)",
          }}
        >
          <h2 className="font-heading text-2xl tracking-tight sm:text-3xl">
            Comece a organizar seus estudos hoje
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Leva menos de um minuto para criar sua conta. Sem cartão de crédito.
          </p>
          <Button size="lg" render={<Link href="/login" />}>
            Criar conta grátis
          </Button>
        </motion.div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-center text-xs text-muted-foreground">
        Study Notes — feito para quem estuda todos os dias.
      </footer>
    </div>
  );
}
