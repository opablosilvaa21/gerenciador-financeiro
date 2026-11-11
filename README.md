# Sobra

Gerenciador financeiro pessoal que roda direto no navegador. O resultado de cada mês aparece em uma cédula
com o valor que sobra; se o mês fechar faltando, a cédula muda de verde-oliva para terracota.

**Abrir o app:** https://opablosilvaa21.github.io/gerenciador-financeiro/

## Como instalar no celular

O Sobra é um PWA: instala direto pelo navegador, sem loja de aplicativos, e depois abre em tela cheia, com ícone
próprio e sem precisar de internet.

- **Android (Chrome):** abra o link e toque em **Instalar** no aviso do topo. Se o aviso não aparecer, use o menu
  do navegador, em **Instalar aplicativo** ou **Adicionar à tela inicial**.
- **iPhone (Safari):** abra o link, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

No computador, também dá para dar dois cliques em `index.html`; nesse caso não há instalação nem modo offline.

Os dados ficam só no aparelho, e nada é enviado para fora. O computador e o celular não se falam, e o app instalado
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
- **Ajustes:** tema escuro (padrão) ou claro, categorias, backup, importação de extrato em CSV.

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
js/core    regras sem interface: dinheiro, datas, dados e cálculos
js/ui      peças de tela: elementos, gráficos em SVG, cédula, formulário e instalação
js/views   uma função para cada tela
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
- **Uma paleta só, em `css/tokens.css`.** Preto, dois verdes-oliva e um sálvia, com terracota e ocre discretos para
  despesa e avisos. Nenhuma cor fica solta no código, e `npm test` confere o contraste de cada par de texto e fundo
  (WCAG AA) nos dois temas.
- **Cores dos gráficos separadas também para daltonismo**, em claro e em escuro: a claridade varia entre as oito
  categorias. A cor segue a categoria, e nenhuma informação depende só de cor.
- **Offline com a rede em primeiro lugar.** Com internet, o app sempre busca a versão nova, então publicar não exige
  trocar número de versão. Sem internet, ou se a rede demorar mais de 3 segundos, usa a última cópia. Ao criar um
  arquivo que a página carrega, inclua-o na lista de `sw.js`; o `npm test` avisa se faltar.

## Testes

```bash
npm test             # regras de negócio, sem instalar nada (precisa do Node.js)

npm install          # só para os testes abaixo
npm run test:e2e     # usa o app no Chrome: digita, clica, erra, desfaz, recarrega
npm run test:mobile  # simula um celular: toque, abas, instalação e abrir com o servidor desligado
```

Se o Chrome estiver em outro lugar, informe o caminho na variável `CHROME_PATH`.

## Limites conhecidos

- Os dados não sincronizam entre aparelhos; para levar a outro navegador, use backup e restauração.
- Não está nas lojas de aplicativos: a instalação é feita pelo navegador.
- Os testes de celular rodam em um Chrome simulando o aparelho, não em um iPhone ou Android de verdade.
- Não há fatura de cartão de crédito: uma compra parcelada é lançada como parcelas mensais.
- Os gráficos têm 8 cores, uma por categoria de despesa; além disso, a categoria aparece em sálvia.

As fontes Bodoni Moda e Public Sans estão em `assets/fonts`, sob a licença SIL Open Font License.
