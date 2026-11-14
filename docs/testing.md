# Testes

Dois níveis locais, cada um com uma fronteira declarada, e um terceiro que só
existe depois da implantação. Não há um nível intermediário: um que só prova que
a função concorda consigo mesma custa tempo de execução e não compra confiança.

## Unitário — `npm test`

Sem entrada e saída, sem contêiner, sem rede. Exercita casos de uso e
adaptadores com implementações de teste das portas, criadas pelas fábricas em
`test/helpers/*-mock.factory.ts`.

O cliente HTTP interno é testado com o `axios` substituído por um mock — a
configuração passada a ele e a tradução de cada falha —, e os dois gateways, com
o cliente substituído por um mock que devolve as fixtures dos serviços. Nenhum
teste deste nível abre conexão.

É este nível que sustenta a cobertura de **100% em linhas, instruções, funções e
ramos**.

## Ponta a ponta — `npm run test:e2e`

O ponto de entrada real, com a composição real, contra um **stub** dos dois
serviços de que a função depende: o Identity, que verifica a credencial, e o
work-order, que devolve os clientes ativos do usuário. O stub
(`test/helpers/internal-services-stub.ts`) é um servidor HTTP de teste, aberto
numa porta livre do próprio processo, que serve as duas rotas internas:

| Rota | Resposta |
| --- | --- |
| `POST /internal/customer-authentications` | `200 { data: { userId } }` para um CPF e uma senha cadastrados no teste; `401` para os demais |
| `GET /internal/users/:userId/customers` | `200 { data: [...] }` com os clientes cadastrados para o usuário; lista vazia para os demais |

Cada teste pode trocar uma resposta por outra — um status 5xx, um redirect, uma
demora maior que o tempo limite — e o stub guarda as requisições recebidas, com
os cabeçalhos, para as asserções de correlação.

Não há Docker nem banco: o nível roda em processo. Que o pacote publicado sobe
no ambiente de execução oficial e alcança os serviços reais é o que os portões
pós-implantação provam, mais abaixo.

### As fixtures dos serviços

As respostas do stub são as **fixtures** que cada serviço publica: arquivos JSON
com uma resposta de exemplo da rota interna, mantidos e testados no repositório
do dono. Cópias ficam em `app/test/contracts/`:

| Arquivo | Origem |
| --- | --- |
| `identity/internal-customer-authentication.json` | `oficina-mecanica-identity-service`, `app/test/contracts/internal-customer-authentication.json` |
| `work-order/internal-user-customers.json` | Provisória: montada a partir do contrato documentado de `GET /internal/users/:userId/customers`, até o `oficina-mecanica-work-order-service` publicar a fixture dessa rota |

O campo `$source` de cada arquivo registra a origem. Quando o dono muda a rota,
a cópia é atualizada e os testes daqui reprovam se a função deixou de entender a
resposta. `test/helpers/contract-fixtures.ts` lê os arquivos já nos tipos que os
gateways devolvem.

O mesmo stub roda fora do Jest por `npm run stub` — ver
[Como executar localmente](local-setup.md#com-o-stub-local).

### O que só a rede de verdade prova

Os casos abaixo dependem do comportamento real do `axios` e do Node.js sobre um
socket, e por isso vivem aqui, não no unitário:

| Caso | Asserção |
| --- | --- |
| O Identity demora mais que 2 s | `503` |
| O Identity responde um redirect | `503`, sem seguir o redirect |
| O work-order responde 5xx ou recusa a conexão | `503` |
| Cada chamada abre conexão nova | O stub recebe `Connection: close` nas duas |
| A URL interna termina com `/` | A chamada chega a `/internal/...`, sem barra dupla |
| Correlação | O Identity e o work-order recebem o mesmo `x-request-id` e o mesmo `trace_id` do log da função |

### Na esteira

O job `E2E Tests` roda `npm run test:e2e` sem nenhum preparo além da instalação
das dependências: não clona outro repositório, não constrói imagem e não sobe
contêiner.

## Os portões pós-implantação — o teste do artefato implantado

Os dois níveis acima exercitam o código. Nenhum deles prova que o **pacote
publicado** sobe, alcança os serviços reais e emite um token que o work-order
aceita.

Isso é o que os três portões pós-implantação da entrega fazem:

| Portão | O que prova |
| --- | --- |
| Invocação direta da função publicada, com um CPF válido e inexistente → `401` | O pacote carrega, a configuração é válida, o segredo foi lido, a chave de assinatura importou e a função alcança o Identity pelo NLB interno |
| Rota pública com o mesmo CPF → `401` | A autorização de invocação concedida ao API Gateway existe e aponta para a API certa |
| Login de um cliente semeado pela rota pública → `200`, e `GET /api/me/work-orders` com o token → `200` | O work-order devolve o vínculo e aceita o token que a função assina |

Qualquer um dos três reprova a entrega. A discriminação entre `401`, `503`,
`500` e ausência de resposta vem do tradutor de respostas — ver
[CI/CD](ci-cd.md#os-três-portões-pós-implantação).

## Propriedades travadas por teste

Não são testes de cobertura: são testes que existem para que uma refatoração
bem-intencionada não desfaça uma decisão.

| Propriedade | Onde |
| --- | --- |
| CPF inexistente, senha incorreta e ausência de cliente ativo produzem resposta idêntica | unitário e ponta a ponta |
| O token carrega **exatamente** `sub`, `iss`, `aud`, `iat`, `exp` — asserção negativa | `jose-token-issuer.spec.ts` |
| O token é verificável com a chave pública correspondente, e só com ela | `jose-token-issuer.spec.ts` |
| Um PEM inválido falha na **inicialização**, não na primeira assinatura | `jose-token-issuer.spec.ts` |
| O corpo da requisição **nunca** alcança o log — inclusive sob chave neutra | `handler-logging.spec.ts` |
| Nenhuma linha carrega senha, hash, CPF em texto puro ou o token — inclusive quando a chamada ao Identity estoura o tempo ou é redirecionada | unitário e ponta a ponta |
| Toda chave emitida pertence ao dicionário declarado | unitário e ponta a ponta |
| Toda linha da invocação carrega `trace_id`, inclusive o `400` de entrada e o `500` de composição, em que nenhuma chamada sai | `handler-logging.spec.ts` |
| O CPF inválido é recusado **antes** de qualquer chamada ao Identity ou ao work-order | `authenticate-customer.use-case.spec.ts` |
| Só o `401` do Identity é recusa; outro 4xx dele segue como falha de chamada, que responde `503` | `http-identity-customer-credentials-gateway.spec.ts` |
| A resposta de sucesso não publica campo novo do DTO por acidente | `customer-auth.presenter.spec.ts` |
| Em produção, segredo em variável de ambiente é recusado | `environment.spec.ts` |
| O ponto de entrada carrega **sem nenhuma dependência instalada**, fora da árvore do repositório | job `Package` |

## Cobertura

100% em linhas, instruções, funções e ramos, verificado por `npm run test:cov`.

Exclusões, todas por caminho ou sufixo e limitadas a arquivos sem lógica
testável:

| Padrão | Razão |
| --- | --- |
| `src/bootstrap.ts` | Composição de dependências: fiação, sem ramificação de negócio. Tem spec própria, ainda que não conte para a métrica. |
| `src/**/*.interface.ts` | Portas: declarações de tipo, apagadas na compilação. |
| `src/**/*.dto.ts` | DTOs de caso de uso: declarações de tipo. |
| `src/**/*.request.ts`, `src/**/*.response.ts` | Formas de requisição e resposta do adaptador e dos gateways: declarações de tipo. |
| `src/**/*.catalog.ts` | Catálogos declarativos de evento: dados, não comportamento. |

Ponto de entrada, validação de configuração, cliente HTTP interno, gateways,
validador de evento e tradutor de resposta **não** são excluídos: todos contêm
ramificação e falham de formas visíveis ao cliente.

A mesma lista aparece em `sonar-project.properties`, para que a métrica local e
a do portão descrevam o mesmo conjunto de arquivos.

## Material de teste

Nenhuma chave de assinatura é versionada. O emissor e a suíte de ponta a ponta
**geram um par RSA em tempo de teste** e verificam com a chave pública
correspondente — o que remove custódia de material sensível do repositório e
mantém o cenário legível ao lado da asserção.

As únicas respostas importadas de fora são as fixtures dos serviços, descritas
acima.
