# CI/CD

A aplicação fica em `app/` e as etapas Terraform executam em `infra/`,
seguindo a mesma organização da API.

Três workflows, com ciclos de gatilho independentes: validação de integração,
análise estática e entrega.

| Workflow | Arquivo | Dispara em | Termina em |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | `push` em `feature/**` e `fix/**` | Pull Request aberto para `main` |
| SAST | `.github/workflows/sast.yml` | Pull Request para `main` e `push` em `main` | Portão de qualidade da análise estática |
| CD | `.github/workflows/cd.yml` | `push` em `main` e execução manual | Rota pública respondendo pela função, em dois jobs: entrega e verificação |

![CI Workflow: os seis jobs de validação — Lint, Type Check, Unit Tests, E2E
Tests, Package e Terraform Validation — executam em paralelo a partir do push e
convergem no job Open Pull Request, que abre o PR para main](diagrams/ci-workflow.png)

## Integração contínua

Os jobs usam `contents: read` no `GITHUB_TOKEN`; `open-pr` cria PRs com token
efêmero do GitHub App (`BOT_APP_ID` variable, `BOT_PRIVATE_KEY` secret).
O composite `setup-ci` tem dois steps: `Set up Node` instala Node 24 e habilita
cache por `app/package-lock.json`; `Install dependencies` executa `npm ci`.

O gatilho é `push` nas duas famílias de branch, e **não** o evento de Pull
Request: incluí-lo duplicaria toda execução. Um `push` mais recente na mesma
branch cancela a execução anterior.

Uma branch fora de `feature/**` e `fix/**` não produz execução do CI.
O SAST ainda pode executar em um Pull Request para `main`.
Combinada com as verificações obrigatórias da `main`, essa ausência **é o portão
de nomenclatura de branch**: o Pull Request fica em "aguardando reporte" até a
branch ser renomeada. É intencional, e não se corrige afrouxando o gatilho.

Os seis jobs de validação executam em paralelo. A abertura do Pull Request
depende de todos.

| Job | O que prova | O que o reprova |
| --- | --- | --- |
| `Lint` | Formatação canônica e a cerca de camadas | Divergência de formatação, ou uma importação de infraestrutura a partir de `domain/` ou `application/` |
| `Type Check` | Que o código **tipa** | Qualquer erro de tipo. Existe separado porque a construção é `esbuild`, que apaga anotações de tipo **sem verificá-las**: sem este job um erro de tipo é empacotado e publicado |
| `Unit Tests` | Comportamento com cobertura total | Cobertura abaixo de 100% em linhas, instruções, funções ou ramos |
| `E2E Tests` | Correspondência com o schema real, mantido pela API | Consulta referenciando coluna ou tabela ausente no schema |
| `Package` | Que o artefato **carrega** | Alias de caminho sobrevivente no pacote, dependência de carregamento não embutida, ou pacote acima do limite de envio direto |
| `Terraform Validation` | Formatação, consistência e — quando o ambiente responde — a prévia | Formatação divergente, configuração inconsistente, ou prévia que **execute e falhe** |
| `Open Pull Request` | — | Não é verificação de validade e não entra nas obrigatórias |

### Steps de cada job de CI

#### `lint` — Lint

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Lint | Executa `npm run lint`; formatação/restrições de camada divergentes reprovam. |

#### `type-check` — Type Check

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Type check | Executa `npm run typecheck`; erro de tipo reprova antes do empacotamento esbuild. |

#### `unit-tests` — Unit Tests

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Unit tests with coverage | Executa `npm run test:cov` e exige os limiares de cobertura do projeto. |

#### `e2e-tests` — E2E Tests

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Check out the API repository at the pinned commit | Obtém a API em `API_MIGRATOR_COMMIT` para usar o schema real; não acompanha main implicitamente. |
| 4 | Build the migrator image from source | Constrói localmente a imagem migradora da API no commit fixado. |
| 5 | E2E tests against the API-owned schema | Executa a suíte E2E com o schema da API em banco descartável; incompatibilidade reprova. |

#### `package` — Package

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Build | Compila/empacota a aplicação em `app/dist` com o comando de build do projeto. |
| 4 | Load the entry point with no dependencies installed | Carrega o pacote em diretório temporário fora da árvore, sem node_modules, e exige a exportação do handler. |
| 5 | Check the package against the direct upload limit | Compacta/verifica o tamanho frente ao limite de envio direto da função; excesso reprova. |

#### `tf-validate` — Terraform Validation

Sem `needs`; executa em paralelo aos demais jobs de validação.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | hashicorp/setup-terraform | Instala/configura a CLI Terraform para os comandos seguintes. |
| 3 | Terraform Fmt Check | Executa `terraform fmt -check -recursive`; divergência de formatação reprova o job. |
| 4 | Terraform Init Lambda Customer Auth | Executa `terraform init -backend=false -no-color`: instala os providers sem conectar ao backend. Registry/cache indisponível pode reprovar. |
| 5 | Terraform Validate Lambda Customer Auth | Executa `terraform validate -no-color` com os schemas instalados; inconsistência de sintaxe, tipo ou referência reprova. |
| 6 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 7 | Build the package for the plan | Gera `app/dist` no próprio job, pois o archive_file do Terraform precisa dessa saída para o plan. |
| 8 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. Este step tolera falha e conserva `aws_creds.outcome` para decidir entre plan e nota de skip. |
| 9 | Terraform Plan Lambda Customer Auth | Só com `aws_creds.outcome == success`: executa init com backend (`-reconfigure`) e plan. Qualquer erro desses comandos reprova o job. |
| 10 | Note skipped plan in job summary | Só com `aws_creds.outcome == failure`: registra no resumo que a prévia foi pulada; não ignora erro de um plan executado. |

#### `open-pr` — Open Pull Request

`needs`: `lint`, `type-check`, `unit-tests`, `e2e-tests`, `package`, `tf-validate`. Executa após sucesso de todos.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Generate GitHub App Token | Gera `app_token` com `BOT_APP_ID` e `BOT_PRIVATE_KEY`; o próximo step recebe o token como `GH_TOKEN`. |
| 3 | Open a PR to main if none exists | Consulta `gh pr list` para head → main e cria o PR só se não houver um aberto; erro do CLI reprova o job. |

### O que `Package` afirma, e por quê assim

O ponto de entrada é carregado num diretório temporário **fora da árvore do
repositório**, sem nenhuma dependência instalada, e a asserção é que ele expõe a
função de tratamento.

O detalhe do diretório não é zelo: a resolução de módulos sobe pelos diretórios
ancestrais e encontraria as dependências instaladas do projeto, transformando a
asserção em teatro.

O cliente do gerenciador de segredos é **embutido** no pacote — ver
[ADR 0004](adr/0004-empacotamento-e-publicacao.md). O único módulo que permanece
externo é o binário opcional do driver de banco, que o driver referencia atrás
de um acessor preguiçoso que esta função nunca toca: ele não é resolvido durante
o carregamento, e por isso a asserção passa.

### A imagem migradora vem de um commit fixado

`E2E Tests` obtém o código da API num identificador de commit declarado em
`API_MIGRATOR_COMMIT`, no próprio workflow, e constrói a imagem localmente.

É autocontido: funciona ainda que o pipeline daquele repositório nunca tenha
executado. E fixar no workflow torna a atualização do contrato de schema um
commit revisável, com diferença visível — o momento certo para revisar a
compatibilidade.

### A prévia de infraestrutura é opcional por projeto

`terraform fmt`, `terraform init -backend=false` e `terraform validate` executam
sempre, sem credenciais: fontes de dados não são avaliadas nessas etapas.

A prévia executa somente se `Configure AWS Credentials` concluir com sucesso.
A falha desse step é tolerada e produz a nota de skip; um laboratório
indisponível depois da autenticação pode falhar no init/plan e reprovar o job.
As validações estáticas e a construção do pacote precisam passar em ambos
os casos.

O job constrói o pacote antes da prévia, no próprio job: a configuração declara
uma fonte de dados sobre o diretório de saída da construção, e jobs não
compartilham sistema de arquivos.

## Análise estática

![SAST Workflow: os quatro steps do job único sast — Checkout com histórico
completo, Setup CI, Unit tests with coverage e SonarQube Scan — em sequência,
terminando no Quality Gate](diagrams/sast-workflow.png)

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 3 | Unit tests with coverage | Executa `npm run test:cov` e exige os limiares de cobertura do projeto. |
| 4 | SonarQube Scan | Analisa `app/` com `SONAR_TOKEN`, consumindo o relatório de cobertura da mesma execução; aguarda o Quality Gate configurado. |

Workflow próprio, com ciclo de gatilho próprio: o plano de análise da solução
cobre a branch principal e Pull Requests, não branches de trabalho.

O SAST dispara nos eventos `opened`, `synchronize` e `reopened` de PRs para
`main`, além de pushes em `main`. Usa concorrência
`sast-${{ github.event.pull_request.number || github.ref }}` com cancelamento
de execuções obsoletas. Não há `needs` entre CI, SAST e CD.

Sendo separado, uma análise vermelha na `main` não interrompe uma entrega em
curso; sendo verificação obrigatória, bloqueia o merge.

A cobertura é produzida **na mesma execução** pela suíte unitária, e a análise a
consome de `coverage/lcov.info`. Relatório versionado ou de execução anterior
reportaria número fabricado.

`sonar.qualitygate.wait=true` vive em `app/sonar-project.properties`: o passo
aguarda o portão e reprova quando ele reprova.

**Não há análise dinâmica neste repositório**, por decisão registrada no
[ADR 0006](adr/0006-sem-analise-dinamica.md).

## Entrega contínua

![CD Workflow: gatilho em push na main ou workflow_dispatch, portão de entrada
por branch e interruptor, e os jobs Deploy Lambda (13 steps) e Post-Deploy Gates (3 steps), ligados por needs: deploy](diagrams/cd-workflow.png)

### Portões de entrada

Duas condições de entrada e o escopo do job:

1. **A referência é a branch principal.** No disparo manual a referência é a
   branch escolhida por quem dispara. A condição está no job, e é ela que carrega
   o peso: **job pulado não recebe segredo algum**.
2. **O interruptor `ENABLE_DEPLOY` está ligado**, ou a execução é manual. O
   disparo manual ignora o interruptor de propósito: é o caminho de ligar o
   ambiente sob demanda. Uma execução pulada pelo interruptor **não é falha**.
3. **O job usa o environment `production`.** É o escopo da chave de assinatura.

### Enfileiramento

O grupo de concorrência é `production`, e `cancel-in-progress` é `false`: uma
aplicação em curso **nunca** é interrompida. O que está sendo protegido é o state
da infraestrutura.

A garantia é a que o provedor implementa, e não mais que isso: apenas **uma**
execução fica pendente por grupo, e uma execução mais recente **substitui a
pendente anterior**. Uma terceira entrega disparada enquanto a primeira executa
descarta a segunda e assume a posição pendente. O resultado aceito é "o commit
mais recente vence" — não "toda execução enfileirada será executada".

### Dois jobs, e o motivo de serem dois

A entrega e a verificação vivem em **jobs separados**, encadeados por `needs`.

| Job | O que faz | Quando executa |
| --- | --- | --- |
| `Deploy Lambda` | Publica a função | Passados os três portões de entrada |
| `Post-Deploy Gates` | Prova que o que foi publicado atende | Só se a entrega concluir com sucesso |

A separação é de leitura, e ela importa: quando um portão reprova, a função
**foi** publicada — o que falhou foi a verificação. Com tudo no mesmo job, um
`Deploy Lambda` vermelho sugeriria que o provisionamento não aconteceu, e a
reação instintiva seria reverter. É o oposto do certo: os modos de falha que os
portões pegam se consertam **para frente**.

`needs` sozinho já é a condição do segundo job — ele é pulado junto com o
primeiro quando o interruptor está desligado, e não executa quando a entrega
falha.

#### `Deploy Lambda`

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Validate required secrets | Antes de chamadas à nuvem, verifica a chave de assinatura/PEM e a credencial Datadog quando coleta estiver ligada; ausência reprova com o nome do item. |
| 3 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm e `npm ci` em `app/`. Não gera Prisma; o schema pertence à API. |
| 4 | Build | Compila/empacota a aplicação em `app/dist` com o comando de build do projeto. |
| 5 | hashicorp/setup-terraform | Instala/configura a CLI Terraform para os comandos seguintes. |
| 6 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. |
| 7 | Terraform Init | Executa `terraform init -no-color`, instalando providers e configurando o backend S3 real. |
| 8 | Terraform Validate | Executa `terraform validate -no-color`; inconsistência de configuração reprova o job. |
| 9 | Terraform Plan | Executa `terraform plan -no-color` com `TF_VAR_service_version=github.sha`, coleta opcional e chave Datadog; consulta os três states e mostra as alterações. |
| 10 | Terraform Apply | Usa os mesmos `TF_VAR_*`, empacota `app/dist` e aplica a função e a permissão; `publish=true` registra versões quando há mudança versionável. Não aplica plano salvo. |
| 11 | Read stack outputs | Lê nome/versão da função, ARN do segredo e endpoint público; publica as saídas usadas pelos steps e pelo job pós-deploy. |
| 12 | Write the signing key value idempotently | Grava o material no Secrets Manager com identificador derivado do hash; mesma chave reutiliza a versão existente. |
| 13 | Record the deployment in the job summary | Registra no resumo commit, função, versão publicada e estado da coleta. Executa com `if: always()`, inclusive depois de falha; o resumo não transforma uma falha em sucesso. |

#### `Post-Deploy Gates`

`id: post-deploy-gates`; `needs: deploy`.

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. |
| 2 | Post-deploy gate — real invocation | Invoca a função com evento de credencial inexistente e exige 401; verifica pacote, configuração, segredos e acesso ao banco. |
| 3 | Post-deploy gate — public route | Envia a mesma credencial à rota pública e exige 401; inclui permissão do Gateway para invocar a função. |

O nome da função e o endereço público chegam pelas saídas do job de entrega —
nada é digitado, e nada é recalculado.

### Os dois portões pós-implantação

Um provisionamento verde não é evidência de que a solução responde de fora.
Ambos afirmam a mesma recusa de credencial, e qualquer um deles reprova a
entrega.

**Portão 1 — invocação direta.** Prova, em cadeia: o pacote carrega, a
configuração é válida, os dois segredos foram lidos, a chave de assinatura
importou e a interface de rede alcança o banco.

A discriminação vem de graça do tradutor de respostas que a função já tem:

| Resposta | Significa |
| --- | --- |
| `401` | Banco alcançado, sem correspondência — **é o resultado esperado** |
| `503` | A operação no banco falhou. O tradutor de respostas devolve `503` para **qualquer** falha de banco — rede, credencial ou schema —, porque a causa não vaza para o chamador. Ela está na linha `db.query.failed` do log da função |
| `500` | Configuração inválida ou falha de assinatura |
| Ausência de resposta da aplicação | Pacote ou rede quebrados |

Os dois vivem no job `Post-Deploy Gates`, depois de a entrega concluir.

**Portão 2 — rota pública.** O único elo que a invocação direta **não** exercita
é a autorização de invocação concedida ao API Gateway. Sem ela a rota responde erro de
integração com a função existindo e saudável — exatamente o estado que esta
esteira existe para encerrar.

Os gates exercitam a inicialização e a recusa de credencial. Um `401` não
exercita a assinatura de um JWT novo nem comprova sua aceitação pela API;
esse fluxo positivo exige um cliente de teste com vínculo ativo.

O endereço vem do output do state remoto da stack do API Gateway, e não é digitado. A
rota não declara autorizador próprio, então uma recusa de credencial ali só pode
ter vindo da função.

Esse modo de falha **não se corrige revertendo**: a função está saudável, quem
está errado é o recurso de autorização, e o conserto é para frente.

### Rastreabilidade

O identificador do commit é injetado como variável de ambiente da função —
alimentando o atributo `service.version` que o registro estruturado **já** emite
— e espelhado nas etiquetas do recurso. Toda linha de log carrega o commit em
execução.

### Reversão

Reverter o commit e executar a entrega novamente. A construção é determinística
a partir do código-fonte, então o commit revertido produz o artefato anterior.

Não há apelido de versão: o API Gateway constrói o endereço de invocação sem
qualificador, e adotá-lo exigiria mudança no repositório do gateway — ver
[ADR 0004](adr/0004-empacotamento-e-publicacao.md).

## Confirmação da coleta

A camada de coleta é anexada quando `ENABLE_TELEMETRY_COLLECTION` está ligada.
Com o interruptor desligado, a função é provisionada e opera sem ela.

**A confirmação é empírica e não tem substituto:** depois de uma invocação,
verificar que a função aparece no destino de telemetria. Um provisionamento
verde com o interruptor ligado não prova que a camada entrega — e essa falha é
**da coleta**, distinta de falha da função.

Detalhes em [Observabilidade](observability.md).

## Inventário de configuração externa

Três escopos, e a distinção não é burocrática: **segredo de repositório é
legível por qualquer workflow**, inclusive os disparados por `push` em branch de
trabalho; segredo de environment só é entregue a um job que declara aquele
environment e satisfaz as suas regras.

### Escopo de organização

| Nome | Tipo | Workflow | Finalidade | Obrigatório |
| --- | --- | --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | Segredo | CI, CD | Autenticação na nuvem | CD: sim · CI: não (a prévia é pulada sem ele) |
| `AWS_SECRET_ACCESS_KEY` | Segredo | CI, CD | Autenticação na nuvem | CD: sim · CI: não |
| `AWS_SESSION_TOKEN` | Segredo | CI, CD | Autenticação na nuvem. **A omissão produz falha de token inválido em toda chamada** | CD: sim · CI: não |
| `BOT_APP_ID` | Variável | CI | Identidade da aplicação que abre o Pull Request | Sim |
| `BOT_PRIVATE_KEY` | Segredo | CI | Credencial da mesma aplicação | Sim |
| `DD_API_KEY` | Segredo | CD | Credencial do destino de telemetria. É a **mesma** que a API usa — por isso vive na organização, e não neste repositório | Somente quando a coleta está ligada |

As três credenciais da nuvem expiram a cada reinício do laboratório e precisam
ser renovadas **juntas**.

### Escopo de repositório

| Nome | Tipo | Workflow | Finalidade | Obrigatório |
| --- | --- | --- | --- | --- |
| `SONAR_TOKEN` | Segredo | SAST | Autenticação no serviço de análise estática | Sim |
| `ENABLE_DEPLOY` | Variável | CD | Interruptor de entrega. Ausente ou diferente de `true`, o merge não provoca provisionamento. **Precisa ser de repositório**: a condição está no `if` do job, avaliado antes de o environment ser aplicado | Não (equivale a desligado) |
| `ENABLE_TELEMETRY_COLLECTION` | Variável | CD | Interruptor da camada de coleta | Não (equivale a desligado) |

### Escopo de environment `production`

| Nome | Tipo | Workflow | Finalidade | Obrigatório |
| --- | --- | --- | --- | --- |
| `CUSTOMER_JWT_PRIVATE_KEY` | Segredo | CD | Metade privada do par que assina o token externo. O valor é gravado no gerenciador de segredos pela entrega | Sim |

Esse segredo é usado **exclusivamente** pela entrega, e é o material mais
sensível da solução — por isso vive no environment, onde nenhum workflow de
branch o alcança.

A credencial do destino de telemetria fica de fora dessa regra por um motivo
concreto: ela é a **mesma** que a API usa, já existe no escopo da organização, e
uma cópia no environment não reduziria o alcance que ela já tem — apenas
criaria um segundo lugar para expirar.

### Passos manuais, sem automação

1. Criar o environment `production` para a chave de assinatura. Uma branch
   policy restrita a `main` é opcional; o gate obrigatório já está no job.
2. Carregar `CUSTOMER_JWT_PRIVATE_KEY` como segredo do environment, a partir do
   arquivo local. O cofre do provedor não faz parte do repositório: a regra de
   exclusão do controle de versão é irrelevante para ele.
3. Vincular o projeto no serviço de análise estática com a chave declarada em
   `app/sonar-project.properties`. Sendo verificação obrigatória, uma chave
   inexistente bloqueia **todos** os Pull Requests.
4. Confirmar que a role de execução existe na conta e confia no serviço de
   funções.
5. Confirmar que a **credencial que implanta** — e não a role de execução —
   possui as permissões de implantação: criar função e repassar a role, definir
   concorrência, criar e gravar segredo, conceder autorização de invocação,
   definir retenção de grupo de log e acessar o backend do state.
6. Confirmar que a cota de execuções concorrentes da conta comporta a reserva
   pretendida, deixando ao menos cem execuções não reservadas.

### Exposição aceita conscientemente

A prévia opcional de infraestrutura em `Terraform Validation` usa credencial da
nuvem num workflow disparado por `push` em branch de trabalho, **num repositório
público**. Quem tem permissão de escrita pode alcançar essa credencial alterando
o workflow na própria branch, e a saída da prévia vai para um log público, onde
o mascaramento do provedor é conveniência e não fronteira.

Aceito, com três atenuantes:

- Pedido de merge vindo de bifurcação **não** recebe segredo.
- A credencial é de laboratório e expira a cada reinício.
- A prévia no pedido de merge é o único lugar onde a diferença de infraestrutura
  é revisada **antes** da integração — o padrão dos quatro repositórios de
  infraestrutura da solução.

A chave de assinatura permanece no environment `production`, fora dos jobs de branch de trabalho. As credenciais AWS vêm da organização; `DD_API_KEY` também tem esse escopo, conforme o inventário acima, porque é compartilhada pela coleta da solução. Não há uma cópia isolada no environment para essa credencial.

## Solução de problemas

### Credencial da nuvem expirada

**Sintoma.** Na validação, a prévia é pulada e o resumo registra o fato — o job
aprova. Na entrega, falha de autenticação.

**Causa.** O laboratório foi reiniciado. As três credenciais expiraram juntas.

**Correção.** Renovar `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e
`AWS_SESSION_TOKEN` no escopo da organização, **as três**. Uma renovação parcial
que omita o token de sessão produz falha de token inválido em toda chamada.

### Trava de state órfã

**Sintoma.** `terraform init` ou `apply` reprova indicando bloqueio existente.

**Causa.** Uma sessão da nuvem expirou no meio de uma aplicação, e o arquivo de
bloqueio ficou no armazenamento de objetos.

**Correção.** Confirmar que nenhuma execução está de fato em curso e remover o
bloqueio com `terraform force-unlock <id>`, com o identificador que a mensagem de
erro informa.

### Ambiente desligado

**Sintoma.** A entrega é pulada e a execução aparece como bem-sucedida sem ter
provisionado nada.

**Causa.** `ENABLE_DEPLOY` não está em `true`. É o comportamento pretendido, e
não uma falha.

**Correção.** Ligar a variável, ou disparar a entrega manualmente — o disparo
manual ignora o interruptor.

### Diferença de identificador de conteúdo numa prévia local

**Sintoma.** Uma prévia executada numa estação de trabalho acusa mudança no
código da função **sem** mudança de código.

**Causa.** A fonte de dados que monta o arquivo compactado normaliza carimbos de
tempo, mas **não** permissões de arquivo — e elas diferem entre sistemas
operacionais.

**Correção.** Nenhuma no código: o modo de arquivo da saída já é declarado
explicitamente. A prévia da esteira, que executa sempre no mesmo sistema
operacional, é a de referência. Uma prévia local de outro sistema operacional
pode acusar a diferença e deve ser lida com esse contexto.

### Falha na gravação da chave depois da aplicação

**Sintoma.** `terraform apply` aprova, a gravação do valor da chave reprova, e a
rota fica **publicada e inválida** — a função sobe, não encontra valor no
segredo, e toda invocação responde erro interno.

**Causa.** A infraestrutura declara o contêiner do segredo; o valor é escrito
pela entrega, num passo posterior. A janela entre os dois é real.

**Correção.** **Reexecutar a entrega** — não reverter. A função está provisionada
e correta; o que falta é o valor. A gravação é idempotente, então reexecutar é
seguro. Reverter o commit não recupera nada: reaplicaria a mesma infraestrutura
e voltaria a depender da mesma gravação.

## Avaliado e recusado

| Alternativa | Por que não |
| --- | --- |
| Federação por identidade do provedor de código | Exigiria criar um provedor de identidade **e** uma role. O laboratório não permite criar roles. Não é preferência, é impossibilidade |
| Ampliar os prefixos de branch que disparam a validação | Transformaria o portão de nomenclatura de branch em convenção não verificada |
| Gatilho por evento de Pull Request na validação | Duplicaria toda execução |
| Verificação de tipos como passo dentro da construção | Economizaria uma instalação de dependências, ao custo de enfileirar a verificação mais provável de reprovar atrás de uma construção que passaria de qualquer forma |
| Consumir a imagem migradora publicada pelo pipeline da API | Inverteria a dependência: passaria a exigir que aquele pipeline tivesse executado, e o dono do bloqueio deixaria de ser quem consegue resolvê-lo |
| Acompanhar a branch principal da API em vez de um commit fixado | A atualização do schema deixaria de ser revisada, e uma mudança alheia tornaria esta validação vermelha sem commit local |
| Validar migrations nesta esteira | Este repositório não tem definição de schema. Validaria artefato de outro dono |
| A validação produz o `.zip` e a entrega o consome como artefato | Exigiria acoplamento entre workflows por evento de execução ou download por identificador |
| Envio do pacote via armazenamento de objetos | Necessário apenas acima do limite de envio direto, que este pacote não alcança |
| Apelido de versão da função | Exigiria mudar `locals.tf` do repositório do gateway e qualificar a autorização de invocação — uma mudança entre repositórios para obter uma reversão que reverter o commit já entrega |
| Só a invocação direta como verificação, com a rota pública em procedimento manual | Manteria sem dono o único elo que esta entrega existe para fechar |
| Só a chamada à rota pública | Perderia a discriminação entre `401`, `503`, `500` e ausência de resposta que a invocação direta entrega de graça |
| Remover a prévia de infraestrutura da validação | Eliminaria a exposição da credencial e moveria a revisão da diferença para depois da integração, onde ninguém a lê |
| Prévia sob aprovação em environment próprio | Resolveria a exposição, ao custo de uma cerimônia por pedido de merge e de divergência com os outros quatro repositórios |
| Análise dinâmica de segurança | [ADR 0006](adr/0006-sem-analise-dinamica.md) |

## Governança da branch principal

O ruleset da `main` recusa `push` direto, recusa reescrita de histórico, recusa
exclusão e exige Pull Request. Nenhum ator é autorizado a burlar, administradores
inclusive.

Os checks produzidos são os seis de validação e o SAST. `Terraform Validation`
combina verificações estáticas e `plan` dependente do lab; mantê-lo fora dos
required checks evita bloquear PRs por indisponibilidade cloud. A seleção
externa do ruleset deve ser conferida em Settings; ela não é declarada no YAML:

```
Lint · Type Check · Unit Tests · E2E Tests · Package · Terraform Validation · SAST
```

`Open Pull Request` **não** entra: não é verificação de validade.

Os nomes exigidos correspondem exatamente aos nomes produzidos. Uma divergência
de nome é bloqueio permanente do merge, não configuração tolerável.

A branch não é obrigada a estar atualizada em relação à `main` antes do merge:
exigi-lo produziria rebase a cada merge alheio.

**Todos os campos de política de Pull Request são declarados explicitamente.**
Ao aplicar a mesma correção no repositório do API Gateway, o provedor aplicou o seu
próprio valor a um campo **omitido**, alterando a política resultante.

A contagem de aprovações é zero, alinhada à dos demais repositórios da solução:
numa equipe pequena em que o autor é frequentemente o único revisor disponível,
exigir uma aprovação travaria a entrega. Enquanto ela for zero, o descarte de
aprovações obsoletas e a exigência de resolução de conversas não têm efeito e
permanecem desligados — alterar a contagem implica reavaliar os dois.
