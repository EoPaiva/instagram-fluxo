<p align="center">
  <img src="assets/upaiva-animada.gif" width="160" height="160" alt="Logo orbital animada da uPaiva">
</p>

<h1 align="center">Instagram Fluxo</h1>

<p align="center">
  <a href="outputs/instagram-fluxo/manifest.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FEoPaiva%2Finstagram-fluxo%2Fmain%2Foutputs%2Finstagram-fluxo%2Fmanifest.json&amp;query=%24.version&amp;prefix=v&amp;label=Vers%C3%A3o&amp;color=7c3aed&amp;style=for-the-badge" alt="Versão da extensão"></a>
  <a href="#instalação-local"><img src="https://img.shields.io/badge/Chrome-Manifest_V3-1d4ed8?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome Manifest V3, instalação local"></a>
  <a href="https://upaiva.dev/"><img src="https://img.shields.io/badge/upaiva.dev-242934?style=for-the-badge" alt="Site upaiva.dev"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-242934?style=for-the-badge&amp;logo=javascript&amp;logoColor=F7DF1E" alt="JavaScript">
  <img src="https://img.shields.io/badge/HTML5-242934?style=for-the-badge&amp;logo=html5&amp;logoColor=F16529" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS-242934?style=for-the-badge&amp;logo=css&amp;logoColor=B7A3FF" alt="CSS">
  <img src="https://img.shields.io/badge/Python-242934?style=for-the-badge&amp;logo=python&amp;logoColor=85B7E5" alt="Python">
  <img src="https://img.shields.io/badge/PowerShell-242934?style=for-the-badge" alt="PowerShell">
  <img src="https://img.shields.io/badge/SQLite-242934?style=for-the-badge&amp;logo=sqlite&amp;logoColor=61C5F5" alt="SQLite">
</p>

<p align="center">Sugestões, filas e histórico local para administrar quem você segue no Instagram.</p>

<p align="center">
  <a href="#a-fila-em-ação">Demonstração</a> · <a href="#como-funciona">Fluxos</a> · <a href="#instalação-local">Instalação</a>
</p>

## A fila em ação

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="assets/fila-em-acao.png">
    <img src="assets/fila-em-acao.gif" width="800" alt="Gráfico animado de uma fila de exemplo com seis perfis. Quatro confirmados, um para conferir e um pulado.">
  </picture>
</p>

[Ver gráfico estático](assets/fila-em-acao.png)

## Como funciona

### Seguir sugestões

```mermaid
flowchart TD
    accTitle: Fluxo para seguir perfis sugeridos
    accDescr: A extensão verifica a elegibilidade, respeita o intervalo e registra o resultado antes de avançar.
    A["Ler sugestões das referências"] --> B{"Perfil elegível?"}
    B -->|Sim| C["Aguardar e seguir"]
    B -->|Não| D["Pular perfil"]
    C --> E["Conferir e salvar o resultado"]
    classDef choice fill:#2d2454,stroke:#a18ced,color:#f4f0ff
    class B choice
```

<details>
<summary>Parar de seguir todos</summary>

```mermaid
flowchart TD
    accTitle: Fluxo para parar de seguir
    accDescr: A extensão usa a lista Seguindo. Quando a lista demora, confere o estado no próprio perfil antes de continuar.
    A["Abrir a lista Seguindo"] --> B["Remover perfil verificado"]
    B --> C{"Lista confirmou a remoção?"}
    C -->|Sim| D["Salvar remoção"]
    C -->|Demorou| E{"Ainda mostra Seguindo no perfil?"}
    E -->|Não| D
    E -->|Sim| F["Deixar para conferência"]
    D --> G["Avançar na fila"]
    F --> G
    classDef choice fill:#2d2454,stroke:#a18ced,color:#f4f0ff
    classDef pending fill:#382a1e,stroke:#d6a871,color:#ffe8c9
    class C,E choice
    class F pending
```

</details>

Um aviso de restrição do Instagram ou um resultado que a extensão não consegue conferir pausa a fila e preserva o progresso.

## O que faz

- Segue perfis a partir das sugestões de três referências configuráveis, com alternativa pelos seguidores das referências.
- Pula perfis que seguem você, contas já processadas e os perfis de referência.
- Oferece agente de IA opcional com BYOK e fallback entre OpenAI, Claude, Gemini e OpenRouter.
- Executa unfollow de todas as contas em fila, com parada, histórico e conferência de resultados atrasados.
- Mostra a fila em carrossel com miniaturas locais e os cards expansíveis de sugestões e histórico.
- Mantém filas, tentativas e histórico no Chrome. O coletor Windows opcional grava diagnósticos em JSONL.

## Instalação local

1. Clone ou baixe este repositório.
2. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione `outputs/instagram-fluxo`.
4. Abra seu perfil no Instagram e clique no ícone da extensão.
5. Carregue a conta, salve as três referências e escolha a ação desejada.

Ao atualizar, recarregue a mesma instalação para conservar seus dados locais.

## Fluxo e dados

O modo automático usa o intervalo e as pausas configurados. Cada tentativa enviada conta na cota local. O total de ações bem-sucedidas inclui apenas resultados confirmados.

No unfollow, uma confirmação atrasada é conferida no próprio perfil. Se ele ainda aparecer como seguido, a fila registra a pendência e continua pelos demais. Uma nova execução pode conferir os pendentes novamente. A conclusão exige uma contagem nativa de zero e o salvamento do resultado.

As chaves ficam no cofre local. Ao ativar a IA, os dados públicos necessários à análise são enviados ao provedor escolhido. Logs e dados gerados durante o uso ficam fora deste repositório.

## Logs em arquivo no Windows

O histórico funciona no Chrome. Para gravar diagnósticos em `logs/instagram-fluxo`, o coletor Windows incluso precisa do Python e de um vínculo com o ID da extensão. O instalador e o coletor vêm configurados para a instalação original. Uma instalação nova precisa configurar o próprio ID antes de registrar o coletor.

Detalhes de funcionamento estão no [guia da extensão](outputs/instagram-fluxo/LEIA-ME.md).

---

<p align="center">Desenvolvido por <a href="https://upaiva.dev">mPaiva_</a></p>
