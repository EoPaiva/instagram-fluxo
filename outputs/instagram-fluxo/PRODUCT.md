# Fluxo Instagram

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pessoas que usam uma extensão local no Chrome para gerenciar a própria conta do Instagram.

## Product Purpose

Seguir sugestões de três referências configuráveis e limpar a lista Seguindo com controle explícito sobre os perfis removidos. A lista branca protege pessoas que o usuário quer manter.

## Operating Context

Extensão Manifest V3 instalada localmente. O painel opera uma aba autenticada do Instagram. A validação usa um perfil descartável do Chrome e páginas fictícias.

## Capabilities and Constraints

- Seguir perfis elegíveis, remover todos fora da lista branca ou executar um lote de até 200 perfis aprovado no Limpa Perfil.
- O painel separa coleta de referências e envio do lote. Mostra sugestões salvas da conta, das referências e da origem selecionada. Seguir selecionados usa os botões das listas de origem e registra perfis que deixaram de aparecer.
- Um observador acompanha o carregamento das listas. O índice IndexedDB armazena candidatos por conta e nome. Alarmes do Chrome sinalizam filas interrompidas ou ações pendentes de conferência no ícone da extensão.
- O painel lateral nativo mostra o progresso do painel completo e pode cancelar somente a execução vinculada que está sendo exibida.
- O atalho de parada segue o foco do Chrome e o token da execução. Notificações nativas opcionais mostram conclusão e pendências de conferência.
- O Meta Insights opcional consulta métricas de uma conta profissional por ação explícita e usa o token somente para a consulta.
- O Limpa Perfil preserva inventários parciais, importa a exportação local do Instagram e sugere páginas e empresas com base nos sinais visíveis. Perfis incertos aguardam revisão.
- A remoção usa primeiro o motor nativo do Unfollow assistido, processando as linhas disponíveis e carregando mais sem coleta completa inicial. Se a janela não carregar os perfis restantes, a fila pausa. Com a recuperação individual ativada, confere os perfis conhecidos da base local com prova atual de Seguindo. A recuperação não promete descobrir contas ausentes da base nem considera sugestões como contas seguidas.
- Cada remoção exige intervalo autorizado, checkpoint de envio, identificação da linha, confirmação nativa reconhecida e resultado verificado. O próximo alvo aguarda o salvamento do resultado.
- Parada, resultado incerto, controle/conta alterados ou aviso da plataforma interrompem a execução. Despachos sem confirmação recuperam uma pausa de conferência ao reabrir.
- O modo direto é o padrão. O agente de IA é opcional e escolhe apenas perfis observados, sem código arbitrário ou acesso às remoções.
- Sugestões com alternativa pelos seguidores da referência é a origem padrão. A escolha fica salva por conta e por fila.
- Perfis com Seguir de volta, referências, própria conta e memória de já seguidos são excluídos do follow.
- A memória de já seguidos permanece após o unfollow. Dados antigos de listas e de revisão são preservados como histórico, sem reativar a comparação ou o agendamento.
- Cofre criptografado, referências, filas, histórico, decisões, logs e fotos ficam neste Chrome. A versão para Windows também grava novos eventos de diagnóstico em arquivos locais, com retenção e reenvio quando o gravador fica indisponível. O backup dos dados da conta e o diagnóstico excluem chaves.
- O ritmo e as pausas são compartilhados entre seguir e remover. Avisos da plataforma persistem até uma liberação explícita; intervalos não garantem ausência de bloqueio.
- Fotos observadas nos CDNs Meta geram miniaturas locais mediante permissão opcional. Falhas de imagem usam iniciais e não interrompem o fluxo.

## Brand Commitments

Identidade de https://upaiva.dev/: planeta orbital, assinatura mPaiva_, favicon, ícones, tipografia local e rodapé com link. Preservar as animações existentes e os controles de movimento reduzido.

## Evidence on Hand

O pacote é validado em Chrome MV3 com páginas fictícias. Os testes do XState e da rede ficam na pasta tests do projeto de build.

## Product Principles

- Configurar, seguir e remover quando o usuário decidir.
- Mostrar progresso confirmado e oferecer parada.
- Preservar memória e fila sem fingir sucesso quando a plataforma não confirma.
- Reutilizar dados locais e evitar coleta completa como pré-requisito.
- Manter IA e fotos opcionais.
