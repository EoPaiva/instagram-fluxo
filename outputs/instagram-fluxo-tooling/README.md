# Build do Instagram Fluxo

Execute nesta pasta com Node 22.12 ou mais recente.

```powershell
npm ci
npm run build
npm run zip
npm test
```

- `build` gera a versão para Chrome em `.output/chrome-mv3`.
- `zip` gera o mesmo build e cria `.output/instagram-fluxo-v<VERSÃO>.zip`. O número vem de `../instagram-fluxo/manifest.json`.
- `npm test` executa os testes da fila e os testes de rede com dados fictícios. Para testar o pacote montado, execute `$env:FLUXO_EXTENSION_DIR=(Resolve-Path .output/chrome-mv3).Path` antes do comando. Para executar apenas a suíte de rede, use `npm run test:network`.

O WXT empacota o XState de `runtime/queue-machine.mjs` em `queue-machine.js`. Os arquivos do painel e do service worker são copiados da pasta `../instagram-fluxo` pelos caminhos que o Chrome já utiliza.

Para atualizar uma instalação existente, extraia o conteúdo do ZIP na pasta que o Chrome já carrega e use **Recarregar** em `chrome://extensions`. Assim o Chrome continua usando o armazenamento local da instalação.
