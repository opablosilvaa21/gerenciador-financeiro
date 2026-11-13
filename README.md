# Sobra Finance

Gerenciador financeiro pessoal que roda direto no navegador. O resultado de cada mês aparece em uma cédula
com o valor que sobra; se o mês fechar faltando, a cédula muda de verde floresta para ferrugem.

**Abrir o app:** https://opablosilvaa21.github.io/gerenciador-financeiro/

## Como instalar no celular

O Sobra é um PWA: instala direto pelo navegador, sem loja de aplicativos, e depois abre em tela cheia, com ícone
próprio e sem precisar de internet.

- **Android (Chrome):** abra o link e toque em **Instalar** no aviso do topo. Se o aviso não aparecer, use o menu
  do navegador, em **Instalar aplicativo** ou **Adicionar à tela inicial**.
- **iPhone (Safari):** abra o link, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

No computador, também dá para dar dois cliques em `index.html`; nesse caso não há instalação nem modo offline.

Os dados financeiros ficam no aparelho. Quem cria uma conta em **Nuvem** passa a ter também uma cópia guardada na
conta, que se atualiza sozinha: se trocar, perder ou quebrar o celular, basta entrar com a mesma conta no aparelho novo
("Já tenho conta", na tela de boas-vindas) e tudo volta. Sem conta, nada sai do aparelho, e o backup em arquivo, em
**Ajustes**, continua disponível.

## O que dá para fazer

- **Início:** sobra prevista do mês, quanto dá para gastar por dia, para onde foi o dinheiro, contas a pagar
  e a receber, orçamentos apertados e entradas e saídas em 12 meses.
- **Lançamentos:** despesas, receitas e transferências, com busca, filtros, ordenação, ações em lote e
  exportação em CSV.
- **Cartão de crédito:** carteira do tipo cartão com dia de fechamento, vencimento e limite. Mostra a fatura aberta,
  a fechada e as atrasadas, e "Pagar fatura" registra o pagamento como transferência (a compra conta no mês em que foi
  feita; o pagamento não conta de novo). No formulário, diz em qual fatura a compra cai.
- **Lembretes e avisos:** o Início mostra o que vence hoje e amanhã, faturas perto do vencimento e orçamentos acima de
  85%. Em Ajustes dá para receber isso como notificação do celular; no Android com o app instalado, chega mesmo com o
  app fechado (Periodic Background Sync), e nos outros aparelhos quando o app é aberto.
- **Montar meu mês em 1 minuto:** na primeira abertura, saldo, salário, aluguel e limites de mercado e lazer viram
  contas fixas e orçamentos.
- **Parcelas e repetições:** compra parcelada com a soma exata em centavos e conta que se repete todo mês.
- **Carteiras:** saldo de cada uma, transferências e evolução mês a mês.
- **Orçamentos:** limite por categoria, editado na própria linha, com sugestão pela média de gastos.
- **Contas fixas:** o lançamento do mês é criado sozinho como pendente; dá para pausar e retomar.
- **Metas:** quanto falta e quanto guardar por mês para chegar no prazo.
- **Relatórios:** comparação por período e por categoria; todo gráfico também tem visão em tabela.
- **Ajustes:** tema claro (padrão) ou escuro, categorias, backup, importação de extrato em CSV e a escolha de
  participar ou não da contagem anônima de aparelhos.

Quase toda alteração pode ser desfeita, pelo aviso na tela ou com `Ctrl + Z`.

| Atalho | Ação |
|---|---|
| `N` | Novo lançamento |
| `/` | Buscar lançamentos |
| `←` `→` | Mudar de mês |
| `Ctrl + Z` | Desfazer |

## Como é feito

HTML, CSS e JavaScript puros, sem framework e sem etapa de build.

```
js/config.js  versão do app e endereço público do Supabase (contagem de instalações)
js/core    regras sem interface: dinheiro, datas, dados, cálculos e leitura do aparelho
js/ui      peças de tela: elementos, gráficos em SVG, cédula, formulário, microinterações e instalação
js/views   uma função para cada tela, incluindo o painel de instalações
supabase   migration da tabela de instalações
css        tokens.css (cores e fontes) e app.css
sw.js      guarda uma cópia do app para abrir sem internet
test       testes das regras e testes de ponta a ponta no navegador
```

Decisões que valem saber:

- **Dinheiro em centavos inteiros.** Nada de `double`. Um valor com mais de 2 casas é recusado, nunca
  arredondado, e as parcelas somam exatamente o total.
- **Datas como texto no fuso local.** O dia não muda por causa do UTC, e dia 31 cabe no último dia de meses
  mais curtos.
- **Texto digitado nunca vira HTML.** A tela é montada com nós de texto, e o CSV exportado neutraliza fórmulas.
- **Só `store.js` altera os dados.** É o que permite gravar e desfazer em um lugar só.
- **Uma paleta só, em `css/tokens.css`.** Névoa clara, verde floresta, líquen, menta e âmbar, com ferrugem para
  despesa e vinho para erro. Nenhuma cor fica solta no código, e `npm test` confere o contraste de cada par de texto e fundo
  (WCAG AA) nos dois temas.
- **Cores dos gráficos separadas também para daltonismo**, em claro e em escuro: a claridade varia entre as oito
  categorias. A cor segue a categoria, e nenhuma informação depende só de cor.
- **Offline com a rede em primeiro lugar.** Com internet, o app sempre busca a versão nova, então publicar não exige
  trocar número de versão. Sem internet, ou se a rede demorar mais de 3 segundos, usa a última cópia. Ao criar um
  arquivo que a página carrega, inclua-o na lista de `sw.js`; o `npm test` avisa se faltar.

## Backup na nuvem

Opcional, com conta de e-mail e senha (Supabase Auth). Cada conta tem um "cofre" na tabela `vaults`: uma linha com
tudo o que o app guarda, no mesmo formato do backup em JSON.

- **Sozinho.** Cada alteração sobe alguns segundos depois. Sem internet, fica pendente e sobe quando a conexão voltar.
  Ao abrir o app, ao voltar para ele e a cada 5 minutos, ele confere se outro aparelho mudou algo.
- **Dois aparelhos sem perder nada.** Cada gravação diz qual versão do cofre viu por último; se outro aparelho gravou
  antes, o app junta os dois registro por registro (`js/core/sync.js`) e tenta de novo. Lançamento novo nos dois
  lados fica; apagado de um lado sai do outro; a conta fixa do mês criada nos dois aparelhos vira uma só.
- **Aparelho que já tinha dados.** Na primeira vez numa conta que também tem dados, a pessoa escolhe: juntar
  (recomendado), usar os da nuvem ou manter os do aparelho.
- **Só o dono.** Regras do banco (RLS) deixam cada pessoa ler e gravar só o próprio cofre. O servidor guarda as 5
  últimas versões de cada cofre (`private.vault_history`), fora da API, para recuperar dados se algo der errado.
- **Sair e excluir.** Sair da conta mantém os lançamentos no aparelho. Excluir a conta apaga a conta, o cofre e o
  histórico.

- **Código de recuperação.** Ao criar a conta, o app gera um código (16 letras e números) e só fecha depois de a
  pessoa confirmar que guardou. Com ele, "Esqueci minha senha" cria outra senha; o código vale uma vez, as sessões
  abertas caem e um código novo é entregue. No banco fica só o código embaralhado (bcrypt), com limite de 5 erros por
  hora por e-mail. Cadastro: até 5 contas por hora por conexão e 300 no total.
- **Projeto sempre acordado.** O Supabase grátis pausa depois de uma semana sem uso; `.github/workflows/manter-ativo.yml`
  chama a função `keep_alive` todo dia. O GitHub desliga tarefas agendadas após 60 dias sem commits (e avisa por
  e-mail): basta reativar em Actions.
- **Sem e-mail.** A conta é criada pela função `create_account`, já confirmada: o e-mail embutido do Supabase só
  entrega para a equipe do projeto. Por isso, enquanto `emailRecovery` estiver `false` em `js/config.js`, o app não
  oferece "Esqueci minha senha" e pede para anotar a senha. Com um serviço de e-mail próprio configurado no
  Supabase, basta mudar para `true`.
- **Liga sozinha.** A Nuvem só aparece quando o banco tem a tabela `vaults`. Aplicada a migration, ela aparece para
  todo mundo na abertura seguinte, sem publicar o app de novo.

Migration: `supabase/migrations/20261113120000_vaults.sql` (cole no SQL Editor do Supabase e rode).

## Versão para a Play Store

O app Android é o próprio site embrulhado em uma Trusted Web Activity (Bubblewrap): abre em tela cheia, sem barra de
navegador, e recebe as mesmas atualizações automáticas do site. `android/twa-manifest.json` descreve o pacote
(`io.github.opablosilvaa21.sobrafinance`); `.well-known/assetlinks.json` é publicado com o site e diz ao Android que
o app e o site são da mesma pessoa (sem ele, o app abre com a barra do navegador). `privacidade.html` é a política de
privacidade que a Play Store exige.

Para gerar um app novo (a cada versão, suba `appVersionCode` e `appVersionName` no twa-manifest):

```bash
# precisa do JDK 17, do Android SDK (build-tools 36.1.0) e de npm i -g @bubblewrap/cli
cd <pasta-do-projeto-android>        # fora deste repositório; tem twa-manifest.json e a chave de assinatura
bubblewrap update --skipVersionUpgrade
gradlew.bat assembleRelease bundleRelease
# assinar: zipalign + apksigner (APK) e jarsigner (AAB) com a chave do keystore
```

A chave de assinatura (`.keystore`) e as senhas dela **nunca entram no repositório**. Sem ela não dá para publicar
atualizações na Play Store, então mantenha cópia em lugar seguro.

## Contagem de instalações

Para saber quantos aparelhos usam o app, e quais, o Sobra pode registrar cada aparelho em uma tabela `installs` no
Supabase. Só dados técnicos: sistema e versão, navegador, modelo (quando o aparelho informa), tamanho da tela, versão
do app e se ele está instalado. **Nenhum lançamento, saldo ou dado pessoal é enviado**, e `npm test` confere que o
código de envio nem encosta nos dados financeiros.

- **Aviso e recusa.** Na primeira abertura aparece um aviso curto com o botão **Recusar**. Nada é enviado antes da
  resposta, e quem recusa nunca envia. A escolha pode ser mudada em **Ajustes**.
- **Um registro por aparelho.** O aparelho cria um identificador aleatório (`crypto.randomUUID`), guarda no
  `localStorage` e se registra; depois, só renova a data de último uso, no máximo uma vez por dia. Sem rede, nada
  acontece e o app segue normal.
- **Banco fechado.** O app só pode chamar a função `register_install`, que mexe apenas no registro do próprio
  identificador. Ele não lê a tabela. A leitura exige login de administrador (lista `private.admins`).
- **Painel.** Em `#/admin/instalacoes` (fora do menu): total de aparelhos, ativos em 7 e 30 dias, instalados como
  app, novas instalações por dia e a divisão por sistema, modelo e navegador.

O banco é o projeto `sobra-finance` no Supabase (região São Paulo), com a migration de
`supabase/migrations/20261111120000_installs.sql` já aplicada. `js/config.js` traz o endereço e a chave **pública**
(`sb_publishable_…`). A chave secreta (`service_role` ou `sb_secret_…`) nunca entra no código, e `npm test` falha se
aparecer uma. Com `supabaseUrl` e `supabaseKey` vazios, a contagem fica desligada. Para entrar no painel, siga os dois
passos do fim da migration: criar seu usuário e incluí-lo em `private.admins`.

Limites: no iPhone o modelo exato não é informado (fica "iPhone"), e lá o app instalado guarda dados separados do
Safari, então o mesmo iPhone pode contar duas vezes. Limpar os dados do navegador também gera um identificador novo.

## Testes

```bash
npm test             # regras de negócio, sem instalar nada (precisa do Node.js)

npm install          # só para os testes abaixo
npm run test:e2e     # usa o app no Chrome: digita, clica, erra, desfaz, recarrega
npm run test:mobile  # simula um celular: toque, abas, instalação e abrir com o servidor desligado
npm run test:installs  # simula a contagem de instalações e o painel, com um Supabase de mentira
npm run test:cloud   # simula o backup na nuvem com três celulares: celular novo, sem internet, junção
npm run test:novidades  # montar o mês, cartão de crédito, lembretes e avisos do celular
npm run screenshots  # tira fotos das telas em 375 px e no computador
```

Se o Chrome estiver em outro lugar, informe o caminho na variável `CHROME_PATH`.

## Limites conhecidos

- Na nuvem, se o mesmo lançamento for editado em dois aparelhos antes de sincronizar, vale a edição do aparelho que
  sincronizou por último.
- Os dados na nuvem não são criptografados de ponta a ponta: ficam protegidos pelas regras do banco, e o
  administrador do projeto no Supabase consegue acessá-los.
- Não está nas lojas de aplicativos: a instalação é feita pelo navegador.
- Os testes de celular rodam em um Chrome simulando o aparelho, não em um iPhone ou Android de verdade.
- Não há fatura de cartão de crédito: uma compra parcelada é lançada como parcelas mensais.
- Os gráficos têm 8 cores, uma por categoria de despesa; além disso, a categoria aparece em sálvia.

As fontes Fraunces (títulos), Inter (textos) e JetBrains Mono (valores) estão em `assets/fonts`, sob a licença SIL
Open Font License.
