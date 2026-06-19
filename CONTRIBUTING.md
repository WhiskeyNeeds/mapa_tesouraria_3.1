# Contribuir para o projeto

Obrigado por querer contribuir. Siga estas diretrizes para pull requests, issues e estilo de código.

**Fluxo de trabalho**
- Fork ou crie uma branch a partir de `main`/`master` com um nome descritivo: `feature/descrição`, `fix/descrição`.
- Faça commits pequenos e atómicos com mensagens claras (ex.: `feat(auth): adicionar endpoint de login`).
- Abra um Pull Request contra a branch principal do repositório. Adicione descrição do problema, o que foi mudado e como testar.

**Revisão de PR**
- Um ou mais revisores irão verificar o código. Faça alterações quando solicitado.
- Garanta que os testes passam localmente e que não há regressões visíveis.

**Estilo e qualidade**
- TypeScript para ambos os apps; siga as convenções existentes.
- Execute lints/formatters do projecto se existirem antes de submeter.
- Inclua tipos e validações (ex.: `zod`) onde necessário para contratos de API.

**Execução local e testes**
- Instale dependências no root: `npm install`.
- Execute a API em modo dev: `npm run dev:api`.
- Execute o frontend em modo dev: `npm run dev:web`.
- Execute testes na API: `npm run test --workspace=apps/api`.

**Banco de dados**
- Se as suas alterações dependem de migrações, inclua uma nova migration via Prisma e documente o processo de upgrade/rollback.

**Obrigado!**

Contribuições bem-vindas
