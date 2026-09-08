# CI/CD

Três workflows, com ciclos de gatilho independentes: validação de integração,
análise estática e entrega.

| Workflow | Arquivo | Dispara em | Termina em |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | `push` em `feature/**` e `fix/**` | Pull Request aberto para `main` |
| SAST | `.github/workflows/sast.yml` | Pull Request para `main` e `push` em `main` | Portão de qualidade da análise estática |
| CD | `.github/workflows/cd.yml` | `push` em `main` e execução manual | Rota pública respondendo pela função |

![CI Workflow: os seis jobs de validação — Lint, Type Check, Unit Tests, E2E
Tests, Package e Terraform Validation — executam em paralelo a partir do push e
convergem no job Open Pull Request, que abre o PR para main](diagrams/ci-workflow.png)

## Integração contínua

O gatilho é `push` nas duas famílias de branch, e **não** o evento de Pull
Request: incluí-lo duplicaria toda execução. Um `push` mais recente na mesma
branch cancela a execução anterior.

Uma branch fora de `feature/**` e `fix/**` não produz verificação alguma.
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

A prévia é tentada apenas quando as credenciais do ambiente são válidas. Com o
laboratório desligado, ela é pulada, o resumo da execução registra o fato, e o
job **aprova**. Uma prévia que execute e falhe reprova.

O job constrói o pacote antes da prévia, no próprio job: a configuração declara
uma fonte de dados sobre o diretório de saída da construção, e jobs não
compartilham sistema de arquivos.

## Análise estática

![SAST Workflow: os quatro steps do job único sast — Checkout com histórico
completo, Setup CI, Unit tests with coverage e SonarQube Scan — em sequência,
terminando no Quality Gate](diagrams/sast-workflow.png)

Workflow próprio, com ciclo de gatilho próprio: o plano de análise da solução
cobre a branch principal e Pull Requests, não branches de trabalho.

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
por branch e interruptor, e os dez steps do job único Deploy Lambda — Checkout,
Validate required secrets, Setup CI, Build, Setup Terraform, Configure AWS
Credentials, Terraform Init/Validate/Plan/Apply, Write the signing key value
idempotently e os dois portões pós-implantação](diagrams/cd-workflow.png)

### Portões de entrada

Três condições, nesta ordem:

1. **A referência é a branch principal.** No disparo manual a referência é a
   branch escolhida por quem dispara. A condição está no job, e é ela que carrega
   o peso: **job pulado não recebe segredo algum**.
2. **O interruptor `ENABLE_DEPLOY` está ligado**, ou a execução é manual. O
   disparo manual ignora o interruptor de propósito: é o caminho de ligar o
   ambiente sob demanda. Uma execução pulada pelo interruptor **não é falha**.
3. **O environment `production` aceita a branch.** A sua política de branch de
   implantação declara a mesma restrição do item 1. É defesa em profundidade:
   protege se o workflow for editado depois.

### Enfileiramento

O grupo de concorrência é `production`, e `cancel-in-progress` é `false`: uma
aplicação em curso **nunca** é interrompida. O que está sendo protegido é o state
da infraestrutura.

A garantia é a que o provedor implementa, e não mais que isso: apenas **uma**
execução fica pendente por grupo, e uma execução mais recente **substitui a
pendente anterior**. Uma terceira entrega disparada enquanto a primeira executa
descarta a segunda e assume a posição pendente. O resultado aceito é "o commit
mais recente vence" — não "toda execução enfileirada será executada".

### Passo a passo

| # | Passo | Observação |
| --- | --- | --- |
| 1 | Validar os segredos exigidos | **Antes de qualquer chamada à nuvem.** Chave ausente ou sem forma de PEM reprova aqui, com o item nomeado. Interruptor de coleta ligado sem credencial do destino também |
| 2 | Instalar dependências | `npm ci` a partir de `app/` |
| 3 | Construir | `esbuild` para `app/dist` |
| 4 | Autenticar na nuvem | Credencial estática com token de sessão, do escopo da organização |
| 5 | `terraform init` / `validate` / `plan` | Arquivo de bloqueio de provedores em modo somente-leitura |
| 6 | `terraform apply` | O `.zip` é montado pela própria ferramenta a partir de `app/dist`, e uma versão imutável é publicada |
| 7 | Gravar o valor da chave de assinatura | Idempotente: o identificador de requisição vem do resumo criptográfico do material, então reexecutar com a mesma chave devolve a versão que já existe |
| 8 | **Portão 1 — invocação real** | Evento sintético, credencial estruturalmente válida e inexistente. Exige `401` |
| 9 | **Portão 2 — rota pública** | Mesmo corpo, pela rota publicada. Exige `401` |

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
| `503` | Banco inalcançável: a interface de rede não chega lá |
| `500` | Configuração inválida ou falha de assinatura |
| Ausência de resposta da aplicação | Pacote ou rede quebrados |

**Portão 2 — rota pública.** O único elo que a invocação direta **não** exercita
é a autorização de invocação concedida ao API Gateway. Sem ela a rota responde erro de
integração com a função existindo e saudável — exatamente o estado que esta
esteira existe para encerrar.

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

As três credenciais da nuvem expiram a cada reinício do laboratório e precisam
ser renovadas **juntas**.

### Escopo de repositório

| Nome | Tipo | Workflow | Finalidade | Obrigatório |
| --- | --- | --- | --- | --- |
| `SONAR_TOKEN` | Segredo | SAST | Autenticação no serviço de análise estática | Sim |
| `ENABLE_DEPLOY` | Variável | CD | Interruptor de entrega. Ausente ou diferente de `true`, o merge não provoca provisionamento | Não (equivale a desligado) |

### Escopo de environment `production`

| Nome | Tipo | Workflow | Finalidade | Obrigatório |
| --- | --- | --- | --- | --- |
| `CUSTOMER_JWT_PRIVATE_KEY` | Segredo | CD | Metade privada do par que assina o token externo. O valor é gravado no gerenciador de segredos pela entrega | Sim |
| `DD_API_KEY` | Segredo | CD | Credencial do destino de telemetria | Somente quando a coleta está ligada |
| `ENABLE_TELEMETRY_COLLECTION` | Variável | CD | Interruptor da camada de coleta | Não (equivale a desligado) |

Os dois segredos acima são usados **exclusivamente** pela entrega, e por isso
vivem no environment: nenhum workflow de branch os alcança.

### Passos manuais, sem automação

1. Criar o environment `production` **com política de branch de implantação
   restrita à `main`**. Sem regra, o environment é escopo de segredo, não
   proteção.
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

O que um workflow de branch alcança é a credencial do laboratório, e **nada** do
material próprio desta função: a chave de assinatura e a credencial de telemetria
vivem no environment.

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

As verificações obrigatórias são as seis de validação mais a análise estática:

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
