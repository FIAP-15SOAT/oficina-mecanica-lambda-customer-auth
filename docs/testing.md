# Testes

Dois níveis, cada um com uma fronteira declarada. Não há um terceiro: um nível
que só prova que a função concorda consigo mesma custa tempo de execução e não
compra confiança.

## Unitário — `npm test`

Sem entrada e saída, sem contêiner, sem rede. Exercita casos de uso e
adaptadores com implementações de teste das portas, criadas pelas fábricas em
`test/helpers/*-mock.factory.ts`.

É este nível que sustenta a cobertura de **100% nas quatro métricas**.

## Ponta a ponta — `npm run test:e2e`

O ponto de entrada real, com a composição real, contra um PostgreSQL efêmero
migrado pela **imagem da API** — não por definição criada aqui. Rodar contra um
schema local provaria apenas que a função concorda consigo mesma, que é
justamente o defeito a detectar.

Depende de a imagem existir. Produza-a uma vez, no repositório da API:

```bash
docker compose build migrate      # no repositório da API
```

O nível roda em processo, e não dentro de um contêiner com o artefato: o que ele
existe para provar é a correspondência com o schema e o comportamento
observável, e ambos são visíveis daqui. Que o `.zip` publicado sobe no runtime
oficial é verificação de esteira, e pertence à change de infraestrutura.

> **Estado atual:** este nível depende da change da API que introduz `users.cpf`,
> `customers.is_active` e `user_customers`. Ela existe na branch
> `feature/login-cpf` (PR 65) e ainda não foi integrada: até lá, a imagem
> precisa ser produzida a partir dessa branch. Com ela, a suíte passa.

## Propriedades travadas por teste

Não são testes de cobertura: são testes que existem para que uma refatoração
bem-intencionada não desfaça uma decisão.

| Propriedade | Onde |
| --- | --- |
| As quatro causas de recusa produzem resposta idêntica | unitário e ponta a ponta |
| O token carrega **exatamente** `sub`, `iss`, `aud`, `iat`, `exp` — asserção negativa | `jose-token-issuer.spec.ts` |
| O token é verificável com a chave pública correspondente, e só com ela | `jose-token-issuer.spec.ts` |
| Um PEM inválido falha na **inicialização**, não na primeira assinatura | `jose-token-issuer.spec.ts` |
| O corpo da requisição **nunca** alcança o log — inclusive sob chave neutra | `handler-logging.spec.ts` |
| Nenhuma linha carrega senha, hash, CPF em texto puro ou o token | unitário e ponta a ponta |
| Toda chave emitida pertence ao dicionário declarado | unitário e ponta a ponta |
| O CPF inválido é recusado **antes** de qualquer ida ao banco | `authenticate-customer.use-case.spec.ts` |
| A resposta de sucesso não publica campo novo do DTO por acidente | `customer-auth.presenter.spec.ts` |
| `users.cpf` é único — premissa da leitura de uma linha só | ponta a ponta |
| `users.password_hash` não é nulo — premissa da uniformidade do `401` | ponta a ponta |
| Em produção, segredo em variável de ambiente é recusado | `environment.spec.ts` |
| O bcrypt em JavaScript puro verifica um hash da biblioteca **nativa** da API | `bcrypt-hash.service.spec.ts` |

## Cobertura

100% em linhas, instruções, funções e ramos, verificado por `npm run test:cov`.

Exclusões, todas por caminho ou sufixo e limitadas a arquivos sem lógica
testável:

| Padrão | Razão |
| --- | --- |
| `src/bootstrap.ts` | Composição de dependências: fiação, sem ramificação de negócio. Tem spec própria, ainda que não conte para a métrica. |
| `src/**/*.interface.ts` | Portas: declarações de tipo, apagadas na compilação. |
| `src/**/*.dto.ts` | DTOs de caso de uso: declarações de tipo. |
| `src/**/*.request.ts`, `src/**/*.response.ts` | Formas de requisição e resposta do adaptador: declarações de tipo. |
| `src/**/*.catalog.ts` | Catálogos declarativos de evento: dados, não comportamento. |

Ponto de entrada, validação de configuração, validador de evento e tradutor de
resposta **não** são excluídos: todos contêm ramificação e falham de formas
visíveis ao cliente.

A mesma lista aparece em `sonar-project.properties`, para que a métrica local e
a do portão descrevam o mesmo conjunto de arquivos.

## Material de teste

Nenhuma chave de assinatura é versionada. O emissor e a suíte de ponta a ponta
**geram um par RSA em tempo de teste** e verificam com a chave pública
correspondente — o que remove custódia de material sensível do repositório e
mantém o cenário legível ao lado da asserção.

O hash bcrypt produzido pela biblioteca **nativa** da API é a única constante
importada de fora, e vive ao lado da asserção que a usa em
`bcrypt-hash.service.spec.ts`. Ela prova a premissa do
[ADR 0003](adr/0003-bcrypt-em-javascript-puro.md): os dois verificam os mesmos
hashes.
