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
    appVersion: '1.3.0',
    // Trocado pela publicação automática por data e commit (ex.: 202611111530-c04ea53). Fora dela, fica assim.
    build: '__BUILD__',
    // Recuperar a senha por e-mail precisa de um serviço de e-mail próprio no Supabase (o embutido só entrega para a
    // equipe do projeto). Enquanto for false, o app não oferece "Esqueci minha senha" e avisa para anotar a senha.
    emailRecovery: false,
    // Projeto "sobra-finance" (região São Paulo). Chave pública: registra o aparelho e faz login; cada pessoa só
    // alcança o próprio backup, pelas regras do banco (supabase/migrations).
    supabaseUrl: 'https://huidncxxzwpdduoholyg.supabase.co',
    supabaseKey: 'sb_publishable_wkzegfIBKCw6ikMTYkwhHg_f-Alf2or',
  };
})(globalThis);
