# ADR 0001: Acesso ao banco por driver, não por ORM

## Status

Aceito — 2026-08-31

## Contexto

A API principal usa um ORM sobre o PostgreSQL compartilhado, e mantém o schema.
Esta função lê três tabelas daquele schema — `users`, `user_customers` e
`customers` — para decidir **uma** coisa: se uma credencial concede acesso
externo.

O volume de acesso a dados é uma única consulta de leitura, executada uma vez
por invocação. Não há escrita em nenhum caminho.

Usar o mesmo ORM da API exigiria uma de duas coisas: copiar a definição de
schema para cá, ou importar o cliente gerado por ela. As duas recriam o problema
de **dois donos do mesmo schema** — que é justamente o risco que o desenho da
autenticação externa aceita por ser mínimo, e que deixaria de ser mínimo se a
definição passasse a existir em dois lugares.

Além disso, um ORM traria uma etapa de geração no build e um artefato ordens de
magnitude maior, num ambiente em que o tamanho do pacote é tempo de
inicialização a frio.

## Decisão

Usar o **driver PostgreSQL diretamente**, com a consulta escrita à mão.

A decisão precisa de identidade, estado da conta e existência de vínculo com
cliente ativo em **uma** ida ao banco:

```sql
SELECT u.id, u.password_hash, u.is_active,
       EXISTS (
         SELECT 1 FROM user_customers uc
         JOIN customers c ON c.id = uc.customer_id
         WHERE uc.user_id = u.id AND c.is_active = TRUE
       ) AS has_active_customer_link
FROM users u
WHERE u.cpf = $1
```

Escrita assim, ela é mais direta e mais eficiente que o equivalente gerado por um
ORM sobre uma relação muitos-para-muitos, que ou faz junção com desduplicação ou
emite duas consultas. A subconsulta `EXISTS` para no primeiro vínculo que
satisfaz.

A tipagem da linha é uma interface de quatro campos no mapeador de
infraestrutura. **Não há modelo duplicado**: há um mapeador, que é a mesma peça
que a API mantém.

Este repositório **não contém** schema, migration ou DDL. Onde um banco real é
necessário, ele é obtido executando as migrations da API pela imagem dela.

## Alternativas consideradas

**O mesmo ORM da API, com a definição de schema copiada.** Cria dois donos do
schema, com divergência garantida e silenciosa. Rejeitada.

**O mesmo ORM da API, importando o cliente gerado por ela.** Cria dependência de
build entre os dois repositórios e amarra a versão do ORM. Rejeitada.

**Construtor de consultas tipado.** Exigiria a definição de schema neste
repositório para gerar os tipos — reintroduz o problema do ORM em troca de uma
consulta. Rejeitada.

## Consequências

**Positivas.** Artefato pequeno e sem etapa de geração no build. A consulta é
legível e a decisão de acesso fica visível em um lugar. A API continua dona única
do schema.

**Negativas.** A correspondência entre a consulta e o schema não é verificada
pelo compilador. A mitigação é o nível de integração, que roda contra um banco
migrado pela API: se a consulta referenciar coluna ou tabela que a migration não
cria, o build fica vermelho — e é por isso que aquele nível é obrigatório e não
opcional.

**Dívida registrada.** A concessão de menor privilégio no banco depende de
migration, que pertence à API, e foi adiada. A função conectará com uma role mais
privilegiada do que precisa, mitigada por ser somente leitura por construção.

## Referências

- [Banco de dados](../database.md)
- [Testes › Ponta a ponta](../testing.md#ponta-a-ponta--npm-run-teste2e)
- ADR de autenticação de clientes da API (`docs/adr/0004-autenticacao-de-clientes.md`, em `oficina-mecanica-app`) — o modelo de identidade que esta função lê
