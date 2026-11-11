# Sobra

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

Os dados financeiros ficam só no aparelho e nunca são enviados para fora. O computador e o celular não se falam, e o app instalado
pode ter dados separados dos do navegador. Limpar os dados do navegador apaga o Sobra, então baixe um backup de vez
em quando em **Ajustes**. Para levar os dados a outro lugar, restaure esse backup lá.

## O que dá para fazer

- **Início:** sobra prevista do mês, quanto dá para gastar por dia, para onde foi o dinheiro, contas a pagar
  e a receber, orçamentos apertados e entradas e saídas em 12 meses.
- **Lançamentos:** despesas, receitas e transferências, com busca, filtros, ordenação, ações em lote e
  exportação em CSV.
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
npm run screenshots  # tira fotos das telas em 375 px e no computador
```

Se o Chrome estiver em outro lugar, informe o caminho na variável `CHROME_PATH`.

## Limites conhecidos

- Os dados financeiros não sincronizam entre aparelhos; para levar a outro navegador, use backup e restauração.
- Não está nas lojas de aplicativos: a instalação é feita pelo navegador.
- Os testes de celular rodam em um Chrome simulando o aparelho, não em um iPhone ou Android de verdade.
- Não há fatura de cartão de crédito: uma compra parcelada é lançada como parcelas mensais.
- Os gráficos têm 8 cores, uma por categoria de despesa; além disso, a categoria aparece em sálvia.

As fontes Fraunces (títulos), Inter (textos) e JetBrains Mono (valores) estão em `assets/fonts`, sob a licença SIL
Open Font License.
