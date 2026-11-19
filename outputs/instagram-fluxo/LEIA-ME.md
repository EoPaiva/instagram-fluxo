# Instagram Fluxo 3.1.3

Dois fluxos: seguir perfis das suas referências e parar de seguir todos por um botão. A comparação de seguidores, a revisão seletiva e os alertas de 72 horas foram removidos.

## Atualizar sem perder os dados

1. Mantenha a pasta que já está carregada no Chrome e substitua nela os arquivos desta versão.
2. Em `chrome://extensions`, clique em **Recarregar** no Instagram Fluxo.
3. Atualize a aba do Instagram e reabra o painel pelo ícone da extensão.

Use a mesma instalação e o mesmo perfil do Chrome. Outra pasta pode receber outro identificador e uma base separada; desinstalar pode apagar os dados da extensão. Cofre, referências, histórico, fotos e filas salvas não são apagados nesta atualização. Os ZIPs anteriores permanecem disponíveis. Arquivos antigos de comparação podem ser removidos da pasta; o novo painel não os carrega e o worker não atende suas ações.

Na primeira instalação: ative Modo do desenvolvedor em `chrome://extensions`, escolha Carregar sem compactação e selecione a pasta com `manifest.json` na raiz.

## Seguir perfis

Abra seu próprio perfil no Instagram, carregue a conta no painel e configure três referências diferentes. Escolha a quantidade e use **Começar a seguir**.

O fluxo abre Seguidores das referências e age nos botões Seguir das sugestões exibidas. A origem **Sugestões + seguidores da referência** vem ativada: se a seção de sugestões não aparecer na busca curta, usa as pessoas exibidas na lista Seguidores da referência. **Somente sugestões** desativa essa alternativa. A busca por sugestões ausentes e as rolagens sem candidatos novos são limitadas; a extensão encerra se a meta não puder ser atingida com os perfis disponíveis.

Seguir de volta, a própria conta, as referências e todos os perfis já seguidos pelo fluxo são excluídos. Seguidores conhecidos em uma lista local antiga também são pulados. A ausência nessa lista não prova que alguém não segue você: o controle nativo continua sendo conferido antes do clique. Não há nova coleta completa de seguidores.

A fila mostra o perfil atual e os próximos observados, com fotos quando disponíveis. Ela guarda o progresso por conta. Ao fechar e reabrir, carregue a mesma conta e use **Retomar fila salva** para a fila automática. O painel não inicia ações sozinho. Os lotes manuais de Seguir selecionados não têm retomada automática.

Quando o clique em Seguir foi enviado e o botão do mesmo perfil continua em Seguir, o modo automático marca a tentativa como sem confirmação, salva a pendência e avança, mesmo quando isso ocorre em vários perfis seguidos. Cada tentativa enviada conta na cota e o perfil fica excluído das próximas filas. A meta conta apenas seguimentos e solicitações confirmados. Restrições do Instagram, mudanças de conta ou de tela, cliques cujo envio não pôde ser verificado e falhas ao salvar interrompem a fila. A fila também termina ao esgotar os perfis disponíveis ou a cota.

## Logs automáticos no Windows

O painel mostra o estado da gravação em **Dados locais**. O gravador usa o Native Messaging do Chrome para acrescentar eventos a arquivos `events-*.jsonl` em `logs/instagram-fluxo`, na pasta do projeto. O registro inclui filas, perfis envolvidos, confirmações, pendências, pausas e falhas dos provedores. Chaves, senha do cofre, cookies, prompts e respostas da IA são excluídos do registro.

O registro começa nas novas execuções da versão 3.1.0. Se o gravador estiver indisponível, a extensão guarda até 20 mil eventos pendentes e tenta gravá-los novamente. O gravador roda sob demanda. A retenção das cópias em arquivo é de até 90 dias ou 256 MiB. O registro marca quando arquivos antigos são descartados.

O gravador foi configurado para uma instalação Windows específica. Antes de registrar um gravador para outra instalação, configure o ID da extensão no instalador e no gravador e indique o executável do Python. Na instalação vinculada, execute `outputs/instagram-fluxo/native-host/install.ps1` com o mesmo usuário do Chrome, recarregue a extensão e confira **Logs automáticos em arquivo ativos** em Dados locais.

Para consultar o registro de hoje no PowerShell, use `python outputs/instagram-fluxo/native-host/read_logs.py --today` a partir da pasta do projeto. O parâmetro `-Uninstall` do instalador reverte o registro do gravador e conserva os arquivos de log.

## Parar de seguir todos

Carregue sua conta e clique em **Iniciar unfollow de todos**. O fluxo usa o motor da extensão local **Unfollow assistido**, adaptado ao painel e ao ritmo compartilhado.

Ele abre a lista **Seguindo** do seu próprio perfil, identifica uma linha, solicita o intervalo salvo, clica em Seguindo, confirma a janela nativa quando presente e verifica a mudança. Só depois de salvar o resultado passa à próxima linha. Carrega mais linhas conforme necessário, sem coletar todos os seguidores ou seguindo antes de começar.

Quando a lista demora para confirmar uma remoção, a extensão confere o estado atual daquele perfil duas vezes. Se a remoção já ocorreu, registra o resultado e continua. Se o perfil ainda mostrar Seguindo, registra uma pendência e continua pelos demais, guardando esse nome para evitar outro clique durante a mesma execução. Uma nova execução iniciada pelo botão pode conferir esse perfil novamente. Cada resultado e pendência fica salvo no registro local.

Se o perfil informar uma contagem positiva, mas a janela Seguindo não trouxer contas seguidas, o painel registra essa diferença e confere os perfis conhecidos na base local. Usa o histórico confirmado e a última lista Seguindo já salva; não inicia uma nova coleta. Nesse caso de recuperação, abre os perfis conhecidos individualmente e exige que cada um mostre o botão Seguindo antes de remover. Seguir, Seguir de volta, Solicitado e contas já removidas pelo fluxo são pulados. Nenhuma sugestão é seguida para criar uma conta removível.

A alternativa pode remover somente relações que estejam acessíveis e conhecidas localmente. Se a lista continuar indisponível, não promete encontrar todos os perfis e não declara conclusão enquanto a contagem nativa não for zero. O motivo fica visível e salvo no log; o botão Parar e os checkpoints funcionam também durante essa recuperação.

Esta opção remove todas as contas que você segue, incluindo quem segue você de volta. Não existe seleção por reciprocidade nem remoção agendada. O início depende do botão e **Parar fluxo** interrompe novas tentativas.

Se fechar o painel durante uma espera, a execução antiga fica sem autorização para novos cliques. Ao reabrir e iniciar novamente, ela é encerrada e a lista atual é usada. Se o painel fechar depois da autorização de uma ação, pode existir uma última ação em andamento: sem resultado salvo, a próxima execução exige conferência antes de continuar. Não reenvia silenciosamente um clique inconclusivo.

O carregamento de novas linhas tem uma espera maior para acomodar respostas lentas. A remoção só aparece como concluída após uma contagem nativa de zero e o salvamento do resultado. Se a lista continuar indisponível ou restarem perfis pendentes, o painel e os logs mostram a pausa e seu motivo. Inicie novamente após conferir a lista.

## Ritmo, parada e restrições

Em **Ritmo das ações**, ajuste intervalos e pausas. O padrão é 45–90 segundos entre tentativas, com dez minutos adicionais a cada dez tentativas. O mesmo agendamento vale para seguir e remover; fechar o painel não apaga a espera. Cada autorização de clique expira em até trinta segundos. O modo automático mantém o limite local de 200 tentativas de seguir em 24 horas; solicitações e resultados inconclusivos também contam.

Avisos de limitação ou verificação interrompem a operação e mantêm uma pausa local. Se o bloqueio aparecer no celular, use **Pausar por bloqueio**. Depois de resolver a situação no Instagram, **Retomar após desbloqueio** libera os controles sem iniciar ações nem apagar a espera. Um clique sem confirmação exige **Liberar após conferir**. Nenhum tempo de espera garante ausência de restrições.

Trocar de janela não é tratado como parada. Fechar ou navegar a aba do Instagram, mudar a conta, interagir manualmente no site, abrir uma janela inesperada ou alterar os controles encerra a remoção. Durante a execução, acompanhe pelo painel.

## Memória e base local

Referências, candidatos, origens, histórico, decisões, limites, filas, resultados e logs ficam separados por conta neste Chrome. A memória de já seguidos é permanente, inclusive depois do unfollow; o primeiro registro não é substituído. Ela identifica o @nome conhecido e não reconstrói ações anteriores que nunca foram registradas ou mudanças de nome.

Dados antigos de seguidores e seguindo são preservados. O painel não oferece comparação nem atualização dessas listas. **Atualizar resumo** consulta a base local; **Exportar dados locais** cria um backup dos dados da conta sem as chaves ou o cofre. Esse arquivo não é necessário para usar os dois fluxos.

## IA e fotos opcionais

Com a IA desligada, o fluxo segue os perfis elegíveis diretamente. Ligada, envia a bio pública e até 40 candidatos observados ao provedor, que escolhe um lote, rolagem, próxima referência ou encerramento. O executor continua responsável pelos controles nativos, exclusões, ritmo e parada. A IA não remove contas nem executa código arbitrário.

O cofre local criptografado oferece OpenAI → Gemini → OpenRouter → Claude. Recusa de chave/permissão ou falta de créditos tenta o próximo provedor configurado. A senha não é armazenada; após reiniciar o Chrome ou recarregar a extensão, desbloqueie o cofre para usar as chaves. Dados públicos podem ser enviados aos provedores durante o fallback; chaves não entram nos logs ou no backup da conta.

As fotos usam endereços observados nos CDNs Meta. **Ativar fotos** concede a permissão opcional para criar miniaturas locais; sem foto válida aparecem iniciais. O cache tem limite de 500 miniaturas/16 MiB e não apaga o histórico.

O planeta, a assinatura animada mPaiva_, os ícones e o rodapé com link para https://upaiva.dev/ permanecem locais. **Pausar animações** e a preferência de movimento reduzido são respeitados.

## Validação e limites

Os testes usam Chrome MV3, a interface da extensão e listas simuladas em um perfil descartável. A remoção depende dos perfis e controles que o Instagram disponibiliza durante a execução.
