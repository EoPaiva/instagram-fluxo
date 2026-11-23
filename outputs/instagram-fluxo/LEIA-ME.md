# Instagram Fluxo 3.9.0

Siga perfis das suas referências, revise sua lista Seguindo no Limpa Perfil ou remova todos os perfis sem proteção. As filas, o inventário e a lista branca ficam separados por conta neste Chrome.

Escolha **Seguir** para ver referências, IA e sugestões. Em **Parar de seguir**, você encontra o Limpa Perfil, a lista branca e a remoção em fila. Os botões da tela inicial apenas trocam a área aberta. O progresso e **Parar fluxo** ficam disponíveis durante a execução.

A fila usa XState para controlar início, parada e salvamento antes de cada ação. A parada aguarda o encerramento do executor e o registro do progresso. Para retomar, use o botão do fluxo correspondente. Perfis com resultado incerto permanecem pendentes de conferência.

## Atualizar sem perder os dados

1. Mantenha a pasta que já está carregada no Chrome e substitua nela os arquivos desta versão.
2. Em `chrome://extensions`, clique em **Recarregar** no Instagram Fluxo.
3. Atualize a aba do Instagram e reabra o painel pelo ícone da extensão.

Use a mesma instalação e o mesmo perfil do Chrome. Outra pasta pode receber outro identificador e uma base separada; desinstalar pode apagar os dados da extensão. Cofre, referências, histórico, fotos e filas salvas não são apagados nesta atualização. Os ZIPs anteriores permanecem disponíveis. Arquivos antigos de comparação podem ser removidos da pasta; o novo painel não os carrega e o worker não atende suas ações.

Na primeira instalação: ative Modo do desenvolvedor em `chrome://extensions`, escolha Carregar sem compactação e selecione a pasta com `manifest.json` na raiz.

## Seguir perfis

Abra seu próprio perfil no Instagram, carregue a conta no painel e configure três referências diferentes.

- Use **Atualizar sugestões** para obter os perfis das referências. A coleta não aciona botões Seguir. Use **Ver perfis salvos** para reabrir os resultados locais.
- Revise a lista no painel e clique em **Seguir selecionados**. A extensão reabre as listas de origem na aba do Instagram para encontrar o botão de cada perfil selecionado. Perfis que deixam de aparecer com **Seguir** são pulados. O lote não abre os perfis individuais.
- Para deixar o fluxo escolher à medida que lê as listas, informe a quantidade e use **Começar a seguir**.

O fluxo abre Seguidores das referências e age nos botões Seguir das sugestões exibidas. A origem **Sugestões + seguidores da referência** vem ativada: se a seção de sugestões não aparecer na busca curta, usa as pessoas exibidas na lista Seguidores da referência. **Somente sugestões** desativa essa alternativa. A busca por sugestões ausentes e as rolagens sem candidatos novos são limitadas; a extensão encerra se a meta não puder ser atingida com os perfis disponíveis.

Perfis com Seguir de volta, a própria conta, as referências e todos os perfis já seguidos pelo fluxo são excluídos. Seguidores conhecidos em uma lista local antiga também são pulados. A ausência nessa lista não prova que alguém não segue você: o controle nativo continua sendo conferido antes do clique. Não há nova coleta completa de seguidores.

A fila mostra o perfil atual e os próximos observados, com fotos quando disponíveis. Ela guarda o progresso por conta. Ao fechar e reabrir, carregue a mesma conta e use **Retomar fila salva** para a fila automática. O painel não inicia ações sozinho. Os lotes manuais de Seguir selecionados não têm retomada automática.

O coletor observa alterações na lista e nos controles do Instagram enquanto a referência está aberta. Um prazo de espera cobre quando a página demora ou não sinaliza o fim do carregamento.

O ícone da extensão mostra **1+** quando há fila automática para retomar e **!** quando um clique precisa de conferência. O Chrome agenda a verificação dos checkpoints salvos. Ao reabrir o painel, carregue a conta para revisar ou retomar. O alerta não abre páginas no Instagram nem executa ações.

Use **Abrir painel lateral**, na seção da fila, para acompanhar o andamento pela lateral do Chrome. O painel mostra a conta, o perfil atual, o progresso e até quatro perfis já identificados na fila. **Parar fila** cancela a execução atual pelo painel completo. Mantenha a aba do painel completo aberta enquanto a operação estiver em andamento. Se ela se desconectar, a lateral mantém o último progresso visível e desativa a parada até voltar a receber dados.

Os atalhos **Seguir**, **Parar de seguir** e **Lista branca** levam à seção correspondente do painel. **Copiar resumo** copia o progresso e os perfis exibidos na lateral.

O atalho padrão **Alt + Shift + S** para a fila da aba ativa do Instagram ou do painel que controla a execução. Se houver mais de um painel vinculado à mesma aba do Instagram, use o atalho no painel da fila que quer parar. Para conferir ou alterar o atalho, abra `chrome://extensions/shortcuts`.

Na seção da fila, ative **Notificações da fila** para receber avisos de conclusão e de ação pendente de conferência. A opção começa desativada e pede permissão no Chrome. Os avisos usam texto genérico para evitar exibir perfis na tela de bloqueio.

## Meta Insights

Abra **Meta Insights** no painel para consultar alcance, visualizações, contas engajadas e interações em 7, 14 ou 28 dias completos. Use o ID numérico da sua conta profissional e um token do Instagram Login com `instagram_business_basic` e `instagram_business_manage_insights`. As datas usam UTC. A extensão só consulta a Meta ao confirmar o formulário. O token é usado no cabeçalho da consulta e apagado do campo, sem armazenamento na extensão. [Guia da Meta](https://developers.facebook.com/documentation/instagram-platform/insights)

Quando o clique em Seguir é enviado e o resultado não é confirmado, a extensão salva a pendência e pausa a conta. Confira o perfil no Instagram e libere a fila pelo painel antes de retomar. A tentativa conta na cota e o perfil permanece excluído das próximas filas. A meta conta seguimentos e solicitações confirmados. Restrições do Instagram, mudanças de conta ou de tela e falhas ao salvar também interrompem a fila.

## Limpa Perfil e lista branca

1. Carregue sua própria conta e, em **Limpa Perfil**, use **Ler lista Seguindo**. A leitura salva o inventário conforme encontra novos perfis. Se a lista parar de carregar, o painel informa que ela está parcial e preserva o que foi lido.
2. Se preferir, importe o JSON ou HTML de **Seguindo**, ou o ZIP da sua exportação oficial do Instagram. A importação ocorre neste Chrome. Confira a conta escolhida, pois a exportação pode estar desatualizada ou ter vindo de outra conta.
3. Revise até 200 perfis por página. Páginas e empresas com sinais no nome ou na categoria disponível aparecem selecionadas. Perfis pessoais e tipos incertos ficam desmarcados. Use **Proteger** ou desmarque uma seleção para adicionar o perfil à lista branca.
4. Clique em **Revisar seleção**, confira a quantidade e confirme o lote. A fila usa a seleção aprovada. Após parar e reabrir, carregue a mesma conta e use **Retomar lote salvo**. O painel mantém resultados confirmados e destaca ações inconclusivas para conferência.

A lista branca vale para o Limpa Perfil e para **Parar de seguir todos**, inclusive na recuperação pelo histórico. A proteção de um perfil vale para todas as contas neste Chrome, mesmo após mudar o @ da conta principal. Abra a conta em que a proteção foi criada para retirá-la. Pare as filas de remoção antes de alterar a lista branca.

## Logs automáticos no Windows

O painel mostra o estado da gravação em **Dados locais**. O gravador usa o Native Messaging do Chrome para acrescentar eventos a arquivos `events-*.jsonl` em `logs/instagram-fluxo`, na pasta do projeto. O registro inclui filas, perfis envolvidos, confirmações, pendências, pausas e falhas dos provedores. Chaves, senha do cofre, cookies, prompts e respostas da IA são excluídos do registro.

O registro começa nas novas execuções da versão 3.1.0. Se o gravador estiver indisponível, a extensão guarda até 20 mil eventos pendentes e tenta gravá-los novamente. O gravador roda sob demanda. A retenção das cópias em arquivo é de até 90 dias ou 256 MiB. O registro marca quando arquivos antigos são descartados.

Para instalar o gravador neste projeto, execute `outputs/instagram-fluxo/native-host/install.ps1` com o mesmo usuário do Chrome. O instalador registra somente a extensão local existente. Depois recarregue a extensão e confira **Logs automáticos em arquivo ativos** em Dados locais. A versão acrescenta as permissões de Native Messaging e de alarme para a gravação e o reenvio.

Para consultar o registro de hoje no PowerShell, use `python outputs/instagram-fluxo/native-host/read_logs.py --today` a partir da pasta do projeto. O parâmetro `-Uninstall` do instalador reverte o registro do gravador e conserva os arquivos de log.

## Parar de seguir todos

Carregue sua conta e clique em **Iniciar unfollow de todos**. O fluxo usa o motor da extensão local **Unfollow assistido**, adaptado ao painel e ao ritmo compartilhado.

Ele abre a lista **Seguindo** do seu próprio perfil, identifica uma linha, solicita o intervalo salvo, clica em Seguindo, confirma a janela nativa quando presente e verifica a mudança. Só depois de salvar o resultado passa à próxima linha. Carrega mais linhas conforme necessário, sem coletar todos os seguidores ou seguindo antes de começar.

Quando a lista demora para confirmar uma remoção, a extensão confere o estado atual daquele perfil duas vezes. Se a remoção já ocorreu, registra o resultado e continua. Se o perfil ainda mostrar Seguindo, registra uma pendência e continua pelos demais, guardando esse nome para evitar outro clique durante a mesma execução. Uma nova execução iniciada pelo botão pode conferir esse perfil novamente. Cada resultado e pendência fica salvo no registro local.

Se a janela Seguindo parar de carregar enquanto o perfil ainda mostra contas seguidas, o painel consulta o inventário do Limpa Perfil, o histórico confirmado e a última lista Seguindo salva. Na recuperação, confere individualmente se o perfil ainda mostra **Seguindo**. No Limpa Perfil, essa conferência se limita aos nomes pendentes do lote confirmado. A lista branca e as pausas por restrição continuam valendo.

A alternativa pode remover somente relações que estejam acessíveis e conhecidas localmente. Se a lista continuar indisponível, não promete encontrar todos os perfis e não declara conclusão enquanto a contagem nativa não for zero. O motivo fica visível e salvo no log; o botão Parar e os checkpoints funcionam também durante essa recuperação.

Esta opção remove as contas que você segue e que estão fora da lista branca, inclusive quem segue você de volta. O início depende do botão e **Parar fluxo** interrompe novas tentativas. Use o Limpa Perfil para revisar uma seleção antes de remover.

A extensão confere o @ antes de acionar o botão de remoção. Se o Instagram abrir uma janela de confirmação sem identificar o perfil, a fila para para conferência.

Se fechar o painel durante uma espera, a execução antiga fica sem autorização para novos cliques. Ao reabrir e iniciar novamente, ela é encerrada e a lista atual é usada. Se o painel fechar depois da autorização de uma ação, pode existir uma última ação em andamento: sem resultado salvo, a próxima execução exige conferência antes de continuar. Não reenvia silenciosamente um clique inconclusivo.

O carregamento de novas linhas tem uma espera maior para acomodar respostas lentas. O painel distingue perfis removidos, protegidos e pendentes. Se a lista continuar indisponível e a extensão não conseguir confirmar os perfis restantes, o painel e os logs mostram a pausa e seu motivo.

## Ritmo, parada e restrições

Em **Ritmo das ações**, ajuste os intervalos para seguir (45 a 90 segundos por padrão) e as pausas entre lotes. **Parar de seguir todos** e **Limpa Perfil** usam 3 a 8 segundos entre tentativas de remoção. A pausa entre lotes, de dez minutos a cada dez tentativas por padrão, vale para os dois tipos de ação. O painel mantém qualquer espera que já estava salva. O modo automático mantém o limite local de 200 tentativas de seguir em 24 horas, incluindo solicitações e resultados inconclusivos.

Avisos de limitação ou verificação interrompem a operação e mantêm uma pausa local. Se o bloqueio aparecer no celular, use **Pausar por bloqueio**. Depois de resolver a situação no Instagram, **Retomar após desbloqueio** libera os controles sem iniciar ações nem apagar a espera. Um clique sem confirmação exige **Liberar após conferir**. Nenhum tempo de espera garante ausência de restrições.

Trocar de janela não é tratado como parada. Fechar ou navegar a aba do Instagram, mudar a conta, interagir manualmente no site, abrir uma janela inesperada ou alterar os controles encerra a remoção. Durante a execução, acompanhe pelo painel.

## Memória e base local

Referências, candidatos, origens, histórico, decisões, limites, filas, resultados e logs ficam separados por conta neste Chrome. A memória de já seguidos é permanente, inclusive depois do unfollow; o primeiro registro não é substituído. Ela identifica o @nome conhecido e não reconstrói ações anteriores que nunca foram registradas ou mudanças de nome.

Os candidatos são indexados localmente com Dexie e IndexedDB. O Chrome copia os candidatos da base antiga para o índice na primeira leitura da conta. O formato da exportação local foi preservado. As chaves continuam no cofre local.

Em **Sua base local → Backup e armazenamento**, use **Salvar backup em pasta** para salvar histórico, lista branca e filas da conta carregada. Em **Restaurar backup**, escolha o JSON e confira a prévia. A restauração incorpora os dados, mantém as proteções existentes e recupera ações incertas para conferência. Os JSONs anteriores da exportação local também podem ser usados para esses dados. Os arquivos podem conter nomes de perfis. As chaves ficam no cofre.

Use **Medir espaço usado** para ver o tamanho do histórico, das filas, das miniaturas e dos logs pendentes. O total principal mede `chrome.storage.local`. O uso do IndexedDB aparece separadamente quando o Chrome fornece a estimativa. O **Histórico de ações** monta as linhas conforme você rola. Use **Home**, **End**, as setas e **Page Up/Down** para navegar.

Dados antigos de seguidores e seguindo são preservados. O Limpa Perfil atualiza seu inventário a partir da própria lista Seguindo ou da exportação local. **Atualizar resumo** consulta a base local. **Exportar dados locais** cria um backup dos dados da conta sem as chaves ou o cofre.

## IA e fotos opcionais

Com a IA desligada, o fluxo segue os perfis elegíveis diretamente. Ligada, envia a bio pública e até 40 candidatos observados ao provedor, que escolhe um lote, rolagem, próxima referência ou encerramento. O executor continua responsável pelos controles nativos, exclusões, ritmo e parada. A IA não remove contas nem executa código arbitrário.

O cofre local criptografado oferece OpenAI → Gemini → OpenRouter → Claude. Recusa de chave/permissão ou falta de créditos tenta o próximo provedor configurado. A senha não é armazenada; após reiniciar o Chrome ou recarregar a extensão, desbloqueie o cofre para usar as chaves. Dados públicos podem ser enviados aos provedores durante o fallback; chaves não entram nos logs ou no backup da conta.

As fotos usam endereços observados nos CDNs Meta. **Ativar fotos** concede a permissão opcional para criar miniaturas locais; sem foto válida aparecem iniciais. O cache tem limite de 500 miniaturas/16 MiB e não apaga o histórico.

O planeta, a assinatura animada mPaiva_, os ícones e o rodapé com link para https://upaiva.dev/ permanecem locais. **Pausar animações** e a preferência de movimento reduzido são respeitados.

## Validação e limites

Os testes usam Chrome MV3 real, a interface da extensão e listas nativas simuladas em um perfil descartável, com tráfego externo bloqueado. As ações de seguir e deixar de seguir são exercitadas em contas fictícias. Isso valida o executor e sua persistência, mas não garante disponibilidade ou carregamento completo do Instagram real.
