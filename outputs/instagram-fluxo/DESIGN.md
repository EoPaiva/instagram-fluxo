---
name: Fluxo Instagram · mPaiva
description: Interface de operação local com a identidade visual do upaiva.dev.
motion:
  maxFrameRate: 30
  maxPixelRatio: 2
  caretDuration: "1050ms"
  wordmarkEntrance: "550ms"
  signatureAssembly: "2400ms"
colors:
  canvas: "#080808"
  surface: "#101010"
  field: "#0b0b0b"
  border: "#292929"
  border-strong: "#484848"
  ink: "#f4f4f4"
  soft: "#d4d4d4"
  muted: "#a0a0a0"
  primary-hover: "#d6d6d6"
  danger: "#f1b5ae"
  danger-border: "#77534e"
  brand-hover: "#181818"
typography:
  display:
    fontFamily: '"Paiva Display", "Helvetica Neue", sans-serif'
    fontSize: "clamp(2.65rem, 4.8vw, 4.6rem)"
    fontWeight: 300
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  heading:
    fontFamily: '"Paiva Display", "Helvetica Neue", sans-serif'
    fontSize: "clamp(1.45rem, 2.4vw, 1.8rem)"
    fontWeight: 300
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Paiva Text", "Helvetica Neue", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Paiva Text", "Helvetica Neue", sans-serif'
    fontSize: "0.79rem"
    fontWeight: 500
  motion-control:
    fontFamily: '"Paiva Text", "Helvetica Neue", sans-serif'
    fontSize: ".74rem"
    fontWeight: 500
    lineHeight: 1.4
  review-display:
    fontFamily: '"Paiva Display", "Helvetica Neue", sans-serif'
    fontSize: "clamp(2rem, 6.5vw, 3.5rem)"
    fontWeight: 300
    lineHeight: 1.02
rounded:
  detail: "3px"
  control: "5px"
  panel: "12px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
    height: "44px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.soft}"
    rounded: "{rounded.control}"
    padding: "10px 0"
    height: "44px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
    height: "44px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "46px"
  navigation:
    textColor: "#b3b3b3"
    height: "56px"
  storage-label:
    textColor: "{colors.muted}"
    rounded: "3px"
    padding: "5px 9px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "clamp(20px, 2.7vw, 32px)"
---

## Overview

**Creative North Star: "mPaiva em operação"**

A identidade do portfólio é aplicada a controles convencionais de uma extensão. A marca aparece no monocromático, nos títulos leves, nas linhas finas e no wordmark, além do planeta orbital e da assinatura mPaiva_ em partículas solicitados pelo proprietário. A navegação continua sendo navegação e a fila continua sendo uma tarefa visível.

## Colors

Canvas e superfícies são neutros escuros. Branco identifica a ação principal e os textos de maior hierarquia. Cinza legível diferencia instruções e metadados. O tom danger fica reservado a erros e remoção de relacionamentos.

## Typography

As fontes Inter do próprio site de referência são servidas localmente como Paiva Display e Paiva Text, com licença OFL em assets/fonts/LICENSE.txt. Essa continuidade de marca justifica a fonte apesar das recomendações genéricas das skills. Títulos usam peso 300. Texto usa 400, controles 500. Quantidades e datas usam numerais tabulares quando aplicável.

## Layout

Conteúdo limitado a 1280px, com margens iguais. Um fluxo vertical organiza conta/referências, progresso, fila, sugestões, histórico, remoção de todos e dados locais. Uma navegação por âncoras oferece acesso direto. Abaixo de 740px o guia fica compacto e os campos de referência empilham. Abaixo de 465px ações principais ocupam a largura disponível. Listas crescem com o conteúdo e não recebem alturas artificiais de uma landing page.

## Elevation & Depth

Elevação por tons e bordas, sem sombras decorativas. O cabeçalho e o progresso são aderentes durante a rolagem, em níveis distintos. Nenhum filtro de blur ou textura de fundo é necessário.

## Motion and brand assets

O planeta usa o algoritmo original do upaiva.dev: esfera de Fibonacci, três anéis inclinados, oclusão e satélites. O canvas ocupa uma região própria na abertura, sem cobrir os controles. A assinatura de partículas no rodapé monta mPaiva_ a partir das fontes locais. O cabeçalho mantém o cursor piscando no ritmo original e uma entrada breve do wordmark.

O movimento é limitado a 30fps e DPR2, pausa fora da tela ou em segundo plano e oferece um botão de pausa com preferência local persistente. Movimento reduzido mostra um quadro estático completo. O texto de fallback continua disponível se o canvas ou a fonte não carregar. Os ícones e favicons são cópias locais dos originais; os PNGs16/32 foram extraídos byte a byte do ICO do site. Não são carregados analytics nem bibliotecas remotas do portfólio.

## Shapes

Painéis com raio de 12px e borda de um pixel. Campos e botões com raio de 5px. Ações não usam pílulas. Ícones pequenos usam SVG geométrico consistente.

## Components

Botões mantêm altura mínima de 44px, foco visível de 2px e feedback discreto de hover/press. O botão principal é branco. Remoção usa texto e borda em danger. Campos têm fundo field e altura de 46px. A configuração de IA usa details/summary nativo. Progresso usa progress nativo. Mensagens permanecem nos elementos de status existentes.

O rodapé é um fechamento de marca em fundo surface: preserva a assinatura mPaiva_ em partículas, apresenta o crédito de Mateus Paiva e destaca upaiva.dev em um link nativo amplo, com seta geométrica. O link abre em nova aba com noopener/noreferrer e foco visível. No móvel, crédito e domínio empilham. O hover da seta e do sublinhado é breve e respeita movimento reduzido.

Os ajustes de ritmo ficam em details/summary, com quatro campos numéricos e ações separadas para salvar ou pausar por bloqueio. A interface explicita que os valores locais não garantem ausência de restrições do Instagram. Uma região de status distingue a fila pausada por bloqueio e a retomada após desbloqueio.

O carrossel da fila expande a identidade existente: perfil atual em uma superfície escura com borda mais clara, anteriores e próximos em planos laterais, monogramas derivados dos @nomes reais e tipografia local. Apenas cinco perfis ficam montados no DOM. A transição espacial de420ms acompanha uma mudança real do perfil processado; a consulta manual usa260ms e não modifica o fluxo. Contagens usam numerais tabulares e progress nativo, com espera e confirmação explicitamente diferentes. O móvel enquadra um perfil por vez e identifica os vizinhos em texto. Setas, Home/End e retorno ao atual preservam o acesso por teclado. Movimento reduzido, pausa global e visibilidade controlam as animações; a contagem não produz anúncios por segundo.

Fotos observadas na lista nativa substituem os monogramas quando disponíveis; o recorte circular mantém a mesma medida e as iniciais ficam como alternativa. No celular os retratos anterior e próximo aparecem em40px nos lados do atual, sem duplicar elementos ou requisições. Há no máximo cinco imagens montadas, com carregamento nativo e sem animação extra de espera. Uma pausa de conferência usa mensagem própria e não apresenta uma falha de resultado como restrição imposta pelo Instagram.

Ativar fotos solicita a permissão opcional de leitura de imagens. O worker fornece somente miniaturas JPEG locais verificadas; imagens remotas não são usadas diretamente no carrossel. O controle e seu status reaparecem se a permissão for removida. Origem dos perfis usa um select nativo com rótulo e ajuda próprios, permitindo sugestões ou alternativa pelos seguidores sem ocultar a escolha. O carrossel identifica os perfis vindos dos seguidores da referência.

## Do's and Don'ts

- Do preservar os IDs dos controles existentes ao alterar a apresentação.
- Do diferenciar dados parciais, dados completos e data de coleta na seção local.
- Do manter o modo direto visível e as chaves opcionais.
- Do respeitar prefers-reduced-motion e manter conteúdo visível sem animação.
- Don't introduzir assets externos em tempo de execução, analytics do portfólio ou métricas inventadas.
- Don't combinar bordas com sombras decorativas nem aplicar outra paleta a uma tela secundária.
