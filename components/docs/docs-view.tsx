"use client";

import type { ReactNode } from "react";
import {
  BookOpen,
  Wrench,
  NotebookPen,
  FolderKanban,
  Archive,
  Upload,
  BookMarked,
  Sparkles,
  MessageSquare,
  SlidersHorizontal,
  Smartphone,
  WifiOff,
  Database,
  ShieldCheck,
  Lock,
  RadioTower,
  Layers,
  Cpu,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon className="size-4" />
        </span>
        <h2 className="font-heading text-lg text-foreground">{title}</h2>
      </div>
      <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

function Ul({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-1.5 pl-4 [&>li]:list-disc [&>li]:marker:text-accent/70">{children}</ul>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

export function DocsView() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-16">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl text-foreground">Documentação</h1>
        <p className="text-sm text-muted-foreground">
          Guia de uso das telas e funcionalidades, e as decisões técnicas por trás do
          funcionamento offline do app.
        </p>
      </div>

      <Tabs defaultValue="usage">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="usage" className="gap-1.5">
            <BookOpen className="size-3.5" />
            Como usar
          </TabsTrigger>
          <TabsTrigger value="technical" className="gap-1.5">
            <Wrench className="size-3.5" />
            Decisões técnicas
          </TabsTrigger>
        </TabsList>

        {/* ───────────────────────── Como usar ───────────────────────── */}
        <TabsContent value="usage" className="flex flex-col gap-5 pt-2">
          <Section icon={NotebookPen} title="Tela principal — Notas, Arquivos e Pastas">
            <P>
              Notas, arquivos enviados e pastas dividem a mesma tela (<Code>/notes</Code>) —
              não existe uma tela separada de "arquivos". A barra de busca no topo
              filtra por título e conteúdo; o ícone de etiqueta ao lado busca por tag.
            </P>
            <P>
              A fileira de pastas fica acima da lista de notas. Tocar numa pasta filtra a
              tela para mostrar só o que está nela, sem trocar de página — toque de novo
              (ou no "×") para voltar a ver tudo.
            </P>
            <P>
              Para criar uma nota: toque no botão de escrever na barra inferior, ou
              segure e arraste-a para cima ("Arraste para cima para criar uma nota") —
              solte para confirmar. O sparkle (✨) ao lado abre o menu rápido: Nova nota,
              Nova pasta, Importar.
            </P>
          </Section>

          <Section icon={NotebookPen} title="Editor de notas">
            <P>
              Selecionar um trecho de texto abre um menu flutuante com negrito, itálico,
              lista de tarefas e alinhamento (esquerda/centro/direita/justificado) — ele só
              aparece com texto selecionado, não é uma barra fixa.
            </P>
            <P>
              O botão de imagem no cabeçalho insere fotos na nota (também funciona por
              colar ou arrastar-e-soltar direto no texto). O ícone de alfinete fixa a nota
              no topo da lista; o de compartilhar copia o conteúdo como texto simples.
            </P>
            <P>
              <strong>Listas de tarefas:</strong> Enter dentro de um item de tarefa ainda
              não cria automaticamente um novo item — o jeito que funciona é escrever cada
              item primeiro como parágrafos separados, selecionar todos e então tocar em
              "Lista de tarefas" no menu de seleção, que converte cada linha num item
              marcável de uma vez. Nos cartões da lista principal, cada item da lista de
              tarefas pode ser marcado direto, sem abrir a nota.
            </P>
            <P>
              A nota salva sozinha (com um pequeno atraso após parar de digitar) — o
              indicador abaixo do título mostra "Salvo na nuvem", "Salvo neste
              dispositivo" (offline) ou sincronizando.
            </P>
          </Section>

          <Section icon={FolderKanban} title="Pastas e tags">
            <P>
              Pastas organizam notas e arquivos juntos. Tags são independentes de pasta e
              podem ser aplicadas a várias notas de uma vez pela seleção múltipla (toque
              longo num card para entrar no modo de seleção) — a barra que aparece embaixo
              tem Arquivar, Aplicar tags, Mover (para pasta) e Excluir.
            </P>
          </Section>

          <Section icon={Archive} title="Arquivar e lixeira">
            <P>
              Arquivar tira a nota da tela principal sem apagar nada — ela fica acessível
              em "Arquivados" na barra lateral. Excluir manda para a Lixeira, de onde dá
              para restaurar ou excluir em definitivo (essa segunda ação não tem volta e
              sempre pede confirmação).
            </P>
          </Section>

          <Section icon={Upload} title="Importar arquivos e publicações .jwpub">
            <P>
              O botão Importar (menu ✨ ou arrastar-e-soltar na tela principal) aceita
              PDF, DOCX, XLSX, imagens e arquivos <Code>.jwpub</Code>. Cada tipo tem um
              limite de tamanho próprio — publicações <Code>.jwpub</Code> completas podem
              chegar a 60&nbsp;MB, o restante fica em 15&nbsp;MB.
            </P>
          </Section>

          <Section icon={BookMarked} title="Leitor de publicações (.jwpub)">
            <P>
              Ao abrir um arquivo <Code>.jwpub</Code> já processado, a tela mostra o
              leitor de capítulos em vez do editor de notas comum. Rodapés aparecem como
              um painel lateral no computador ou um Vault (o mesmo componente usado nas
              confirmações) no celular — nunca como uma janela flutuante por cima do
              texto.
            </P>
          </Section>

          <Section icon={Sparkles} title="Assistente de IA">
            <P>
              A barra inferior também é a entrada do assistente: pergunte algo sobre suas
              notas e ele responde com base no que já foi processado (vetorizado). Isso
              depende de uma chave de IA configurada no servidor — sem ela, o assistente
              responde com um texto de exemplo fixo.
            </P>
          </Section>

          <Section icon={MessageSquare} title="Conversas">
            <P>
              Cada pergunta feita ao assistente vira uma conversa, listada na barra
              lateral em "Conversas recentes". Dá para arquivar ou excluir uma conversa
              pelo menu de três pontos ao lado dela.
            </P>
          </Section>

          <Section icon={SlidersHorizontal} title="Configurações">
            <P>
              Dividida em abas: <strong>Visão Geral</strong> (tudo junto),{" "}
              <strong>IA</strong> (uso de tokens/custo estimado e fila de vetorização),{" "}
              <strong>Aparência</strong> (grade, lista ou mosaico) e{" "}
              <strong>Conta &amp; Segurança</strong> (e-mail, exportar backup, zona de
              perigo). O botão "Processar Agora" na fila de IA força o processamento
              imediato dos itens pendentes, sem esperar a rotina automática diária.
            </P>
          </Section>

          <Section icon={Smartphone} title="Instalar como app (PWA)">
            <P>
              Em <Code>/install</Code> tem instruções específicas para o seu aparelho.
              Uma vez instalado, o app abre em tela cheia (sem a barra do navegador) e
              funciona com boa parte do conteúdo disponível offline.
            </P>
          </Section>

          <Section icon={WifiOff} title="O que funciona sem internet">
            <P>
              Suas notas de texto continuam disponíveis e editáveis offline — o cadeado
              verde no cartão da nota vira uma bolinha indicando "salvo neste
              dispositivo" até a conexão voltar. A barra lateral mostra quantas alterações
              ainda estão esperando para sincronizar.
            </P>
            <P>
              Publicações <Code>.jwpub</Code>/PDF/outros arquivos precisam de internet na
              primeira vez que são abertos (o conteúdo deles não é guardado localmente).
            </P>
          </Section>
        </TabsContent>

        {/* ─────────────────────── Decisões técnicas ─────────────────────── */}
        <TabsContent value="technical" className="flex flex-col gap-5 pt-2">
          <Section icon={Database} title="Offline-first de verdade, não só cache otimista">
            <P>
              O estado de notas/pastas fica num store <Code>zustand</Code> persistido em{" "}
              <Code>localStorage</Code>, com uma "fila de saída" (<Code>pendingOps</Code>)
              própria: toda mutação atualiza a tela na hora e só depois tenta a Server
              Action. Se o <Code>fetch</Code> nem chegar a sair (offline de verdade), a
              operação entra na fila em vez de virar um erro — e edições da mesma nota se
              fundem numa só entrada da fila, em vez de empilhar.
            </P>
            <P>
              A reconexão é detectada por três caminhos ao mesmo tempo (evento{" "}
              <Code>online</Code> do navegador, <Code>focus</Code>/
              <Code>visibilitychange</Code>, e um intervalo de 5s como rede de segurança) —
              o evento <Code>online</Code> sozinho não é confiável em todo cenário de
              teste (confirmado com emulação de rede offline do Playwright).
            </P>
          </Section>

          <Section icon={Cpu} title='Por que o "useOffline" do Next 16 está desligado'>
            <P>
              O Next 16 tem uma flag experimental (<Code>experimental.useOffline</Code>)
              que evita que uma navegação ou Server Action offline lance erro — ela
              mantém o pedido pendente em memória e tenta de novo quando a rede volta.
              Testamos e revertemos: isso segura o <Code>fetch</Code> da Server Action
              pendente em memória em vez de rejeitá-lo, o que quebra a detecção baseada em{" "}
              <Code>catch</Code> que a fila de sincronização usa — nada cairia na fila
              persistida, e uma edição feita offline se perderia se a aba fosse fechada
              antes da reconexão. A fila própria é estritamente mais durável para o que o
              app precisa (rascunhos sobrevivem a fechar a aba).
            </P>
          </Section>

          <Section icon={RadioTower} title="O cache do Service Worker e o hash `_rsc`">
            <P>
              Toda navegação interna do Next busca só o payload RSC da página, com um
              parâmetro de cache-busting <Code>_rsc=&lt;hash&gt;</Code> calculado a partir
              do estado da árvore de rotas no momento — a mesma página aberta a partir de
              contextos diferentes gera hashes diferentes, então o cache do Service
              Worker (que guarda por URL exata) praticamente nunca acerta ao reabrir uma
              nota já visitada offline.
            </P>
            <P>
              Quando esse fetch falha, o próprio Next força um recarregamento completo
              (<Code>window.location.href</Code>) como última tentativa — e como o Service
              Worker nunca tinha um documento HTML completo daquela nota em cache (só
              navegação client-side acontece nela), esse recarregamento também falhava e
              caía na tela genérica de offline.
            </P>
            <P>
              A correção: uma regra de cache própria que remove o <Code>_rsc</Code> antes
              de usá-lo como chave (<Code>cacheKeyWillBeUsed</Code>), colapsando toda
              variação de hash da mesma URL numa única entrada.
            </P>
          </Section>

          <Section icon={Layers} title="Fallback dedicado para reabrir notas offline">
            <P>
              Rotas dinâmicas (<Code>/notes/[id]</Code>) não dão para pré-cachear — não dá
              para prever todo id possível. A solução (mesmo padrão usado por outros apps
              Next com esse problema) é uma página de fallback própria,{" "}
              <Code>/notes-offline</Code>, registrada no Service Worker como resposta para
              qualquer navegação de documento que bata em <Code>/notes/algum-id</Code> e
              falhe.
            </P>
            <P>
              Essa página lê o id da nota direto de <Code>window.location.pathname</Code>{" "}
              (nunca dos hooks de rota do Next — a árvore de rotas embutida no HTML
              pré-cacheado é a da própria <Code>/notes-offline</Code>, não a de{" "}
              <Code>/notes/[id]</Code>) e renderiza o conteúdo a partir do store local, que
              já tem a nota mesmo que ela nunca tenha sido sincronizada com o servidor.
              Por isso o botão "Voltar" nessa tela faz um recarregamento completo em vez
              de navegação client-side — o estado do roteador do Next está dessincronizado
              da URL real nesse cenário.
            </P>
          </Section>

          <Section icon={ShieldCheck} title="RLS para dados, checagem manual para Storage">
            <P>
              Notas e pastas são tabelas Postgres reais com Row Level Security — a
              política <Code>auth.uid() = user_id</Code> é a própria barreira de acesso,
              então mesmo um bug no código não vaza dado de outro usuário. O Storage de
              arquivos (bucket privado <Code>files</Code>) não tem política de RLS própria
              (é deny-all por padrão sem nenhuma), então toda operação passa pelo cliente
              service-role no servidor, que confere manualmente se o caminho do arquivo
              começa com o id do usuário autenticado antes de fazer qualquer coisa.
            </P>
          </Section>

          <Section icon={Lock} title="Publicações .jwpub: leitura e descriptografia no navegador">
            <P>
              Um <Code>.jwpub</Code> é um zip com um banco SQLite dentro (às vezes um zip
              dentro do zip). Documentos e notas de rodapé vêm cifrados em AES-CBC e depois
              compactados — a chave sai de um hash SHA-256 combinando idioma, símbolo, ano
              e número de edição da publicação, com uma máscara fixa por cima.
            </P>
            <P>
              Todo esse processamento roda no navegador (não no servidor): precisa de{" "}
              <Code>DOMParser</Code>, que não existe no Node, e reenviar um arquivo de até
              60&nbsp;MB para o servidor duplicaria o upload à toa. As bibliotecas pesadas
              (<Code>jszip</Code>, <Code>sql.js</Code>, <Code>pako</Code>) só entram por
              import dinâmico, então ficam fora do pacote principal do app.
            </P>
          </Section>

          <Section icon={Sparkles} title="Vetorização para busca por IA">
            <P>
              Cada nota editada entra numa fila (<Code>vectorization_queue</Code>) em vez
              de ser processada na hora. Uma rotina agendada (cron) drena essa fila aos
              poucos, em lotes pequenos e com um limite de tempo por lote — o progresso é
              salvo a cada sub-lote de embeddings, então uma nota grande que não termina a
              tempo continua de onde parou no próximo ciclo, sem reprocessar (e recobrar)
              o que já foi salvo.
            </P>
          </Section>

          <Section icon={Smartphone} title="PWA com Serwist, não next-pwa">
            <P>
              O app roda em Next 16 com Turbopack, que é o empacotador padrão a partir
              dessa versão — bibliotecas de PWA baseadas em plugin webpack (como o
              tradicional <Code>next-pwa</Code>) não funcionam nesse pipeline.{" "}
              <Code>@serwist/turbopack</Code> foi escolhido justamente por implementar o
              Service Worker como uma Route Handler comum, compatível com Turbopack desde
              o início.
            </P>
          </Section>
        </TabsContent>
      </Tabs>

      <Badge variant="outline" className="w-fit text-[10.5px] text-muted-foreground">
        Study Notes — documentação interna
      </Badge>
    </div>
  );
}
