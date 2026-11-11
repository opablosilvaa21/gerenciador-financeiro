/**
 * Configuração pública do app.
 *
 * supabaseUrl e supabaseKey são do projeto no Supabase que guarda a contagem de instalações.
 * A chave daqui é a PÚBLICA (publishable, ou a antiga "anon"): ela pode ficar no código, porque só
 * consegue chamar register_install() e fazer login. A chave service_role NUNCA entra neste arquivo
 * nem no repositório.
 *
 * Com os dois campos vazios, a contagem fica desligada: o app não mostra o aviso e não envia nada.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  FM.config = {
    appVersion: '1.1.0',
    // Projeto "sobra-finance" (região São Paulo). Chave pública: só registra o aparelho e faz login.
    supabaseUrl: 'https://huidncxxzwpdduoholyg.supabase.co',
    supabaseKey: 'sb_publishable_wkzegfIBKCw6ikMTYkwhHg_f-Alf2or',
  };
})(globalThis);
