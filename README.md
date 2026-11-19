<p align="center">
  <img src="outputs/instagram-fluxo/icons/upaiva-192.png" width="112" alt="Logo uPaiva">
</p>

<h1 align="center">Instagram Fluxo</h1>

<p align="center">Sugestões, filas e histórico local para administrar quem você segue no Instagram.</p>

<p align="center">
  <a href="https://upaiva.dev">upaiva.dev</a> · Chrome Manifest V3 · JavaScript · Python
</p>

## O que faz

- Segue perfis a partir das sugestões de três referências configuráveis, com alternativa pelos seguidores das referências.
- Pula perfis que seguem você, contas já processadas e os perfis de referência.
- Oferece agente de IA opcional com BYOK e fallback entre OpenAI, Claude, Gemini e OpenRouter.
- Executa unfollow de todas as contas em fila, com parada, histórico e conferência de resultados atrasados.
- Mostra a fila em carrossel com miniaturas locais e os cards expansíveis de sugestões e histórico.
- Mantém filas, tentativas e histórico no Chrome. O coletor Windows opcional grava diagnósticos em JSONL.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Extensão | Chrome Manifest V3, service worker, Chrome Storage e Scripting |
| Interface | HTML, CSS, JavaScript e Web Animations API |
| Persistência | Armazenamento local do Chrome e cofre de chaves |
| IA opcional | OpenAI, Anthropic Claude, Google Gemini e OpenRouter |
| Diagnósticos Windows | Python, Native Messaging, JSONL, SQLite e PowerShell |

## Instalação local

1. Clone ou baixe este repositório.
2. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione `outputs/instagram-fluxo`.
4. Abra seu perfil no Instagram e clique no ícone da extensão.
5. Carregue a conta, salve as três referências e escolha a ação desejada.

Ao atualizar, recarregue a mesma instalação para conservar seus dados locais.

## Fluxo e dados

O modo automático usa o intervalo e as pausas configurados. Cada tentativa enviada conta na cota local. O total de ações bem-sucedidas inclui apenas resultados confirmados. Uma restrição ou verificação do Instagram pausa o fluxo.

No unfollow, uma confirmação atrasada é conferida no próprio perfil. Se ele ainda aparecer como seguido, a fila registra a pendência e continua pelos demais. Uma nova execução pode conferir os pendentes novamente. A conclusão exige uma contagem nativa de zero e o salvamento do resultado.

As chaves ficam no cofre local. Ao ativar a IA, os dados públicos necessários à análise são enviados ao provedor escolhido. Logs e dados gerados durante o uso ficam fora deste repositório.

## Logs em arquivo no Windows

O coletor incluído usa Python e possui vínculo fixo com a instalação local original. Outras instalações precisam de uma configuração específica desse vínculo. O histórico no Chrome funciona independentemente do coletor.

Na instalação vinculada, execute `outputs/instagram-fluxo/native-host/install.ps1`, recarregue a extensão e use **Dados locais → Verificar gravação dos logs**. Os arquivos ficam em `logs/instagram-fluxo`.

Detalhes de funcionamento estão no [guia da extensão](outputs/instagram-fluxo/LEIA-ME.md).

---

<p align="center">Desenvolvido por <a href="https://upaiva.dev">mPaiva_</a></p>
