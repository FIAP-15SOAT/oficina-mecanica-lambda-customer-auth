# Banco de dados

A função é **somente leitura** e **não é dona do schema**.

## O schema pertence à API

Este repositório **não contém** definição de schema, migration ou qualquer DDL —
nem em código de produção, nem em código de teste. As tabelas `users`,
`user_customers` e `customers` são mantidas pela API principal
(`oficina-mecanica-api`), e qualquer necessidade de alteração é endereçada
naquele repositório.

Onde um banco com o schema real é necessário — desenvolvimento local e a suíte
de ponta a ponta —, ele é obtido **executando as migrations da API**, pela
imagem dela. Rodar contra uma definição criada aqui provaria apenas
que a função concorda consigo mesma, que é justamente o defeito a detectar.

## A consulta

Uma tentativa de autenticação faz **exatamente uma** ida ao banco.

```sql
SELECT
  u.id,
  u.password_hash,
  u.is_active,
  EXISTS (
    SELECT 1
    FROM user_customers uc
    JOIN customers c ON c.id = uc.customer_id
    WHERE uc.user_id = u.id
      AND c.is_active = TRUE
  ) AS has_active_customer_link
FROM users u
WHERE u.cpf = $1
```

Ela devolve, de uma vez, tudo o que a decisão precisa: o identificador do
usuário, o hash da senha, o estado da conta e a **existência** de vínculo com
cliente ativo.

**O que ela deliberadamente não faz:**

- não recupera `name` nem `email` — não participam da decisão, e não buscar é
  melhor que mascarar depois;
- não multiplica linhas por vínculo. A subconsulta `EXISTS` responde "há ao
  menos um" e para no primeiro que satisfaz; uma junção exigiria desduplicação,
  e duas consultas exigiriam duas idas ao banco;
- não escreve. Nenhum caminho desta função — de sucesso ou de falha — executa
  `INSERT`, `UPDATE`, `DELETE` ou DDL. Um teste unitário afirma isso sobre o
  texto da consulta.

O parâmetro é o CPF **normalizado**: 11 dígitos, sem pontuação, exatamente como
a API persiste. A normalização daqui remove todo caractere não numérico — regra
mais estrita que a da API, que remove apenas pontuação —, e um vetor de teste
com espaços trava essa diferença dos dois lados.

O mapeamento da linha para o domínio vive em
`infrastructure/persistence/pg/customer-identity.mapper.ts`. Não há modelo
duplicado do schema: há uma interface de quatro campos, que é a mesma peça que a
API mantém.

## Ciclo de vida da conexão

O ambiente de execução é **congelado** assim que a resposta retorna e
reaproveitado nas invocações seguintes. A conexão acompanha esse ciclo.

| Decisão | Valor | Por quê |
| --- | --- | --- |
| Tamanho do pool | `max: 1` | Cada ambiente atende **uma** invocação por vez; qualquer número maior é conexão ociosa consumindo um slot do banco |
| Criação do pool | inicialização do ambiente | Pagar a fiação uma vez por ambiente, não uma vez por invocação |
| Abertura da conexão | primeira consulta | O pool é preguiçoso. Conectar na composição faria um banco indisponível derrubar a inicialização, trocando o `503` correto por um `500` |
| Encerramento ao fim da invocação | **nunca** | Encerrá-la destruiria o reaproveitamento, que é a razão de existir da decisão |
| Expiração por ociosidade | `idleTimeoutMillis: 0` | O ambiente é congelado, não parado — não há ociosidade real a recuperar |
| `keepAlive` | ligado, com atraso inicial de 10 s | Uma conexão congelada por minutos precisa sobreviver ao NAT do caminho |

**Por que pool de um, e não conexão única.** Uma conexão única que entre em erro
fica permanentemente inutilizada até o ambiente ser reciclado. O pool descarta a
conexão quebrada e abre outra na invocação seguinte. Autocura por poucos bytes.

O erro de cliente ocioso tem ouvinte registrado: sem ele, uma conexão derrubada
pelo banco entre invocações emitiria `'error'` sem destino e derrubaria o
processo inteiro — o oposto exato da autocura que o pool existe para dar.

## A forma do segredo

`DATABASE_SECRET_ID` aponta para um segredo cujo valor é um **JSON** com
exatamente os dois campos que o driver consome:

```json
{ "username": "...", "password": "..." }
```

É o formato que o próprio gerenciador de segredos produz para credenciais de
banco. Qualquer outra forma — texto puro, JSON sem um dos campos, campo com outro
tipo — falha na composição com `app.configuration.invalid`, e não na primeira
consulta. Fora de produção, o fallback `DATABASE_SECRET` carrega exatamente o
mesmo JSON.

A chave de assinatura segue regra diferente e está documentada em
[Segurança › Custódia da chave](security.md#custódia-da-chave): ali o valor do
segredo é o PEM puro, e não um JSON.

## Limites de tempo

Nenhuma espera é indefinida.

| Limite | Variável | Padrão |
| --- | --- | --- |
| Aquisição de conexão | `DATABASE_CONNECTION_TIMEOUT_MS` | 3000 ms |
| Execução da consulta (cliente) | `DATABASE_QUERY_TIMEOUT_MS` | 5000 ms |
| Execução da consulta (servidor) | `DATABASE_QUERY_TIMEOUT_MS` | 5000 ms |

O limite de consulta é aplicado nas duas pontas: `query_timeout` interrompe o
cliente, `statement_timeout` interrompe o servidor. Sem o segundo, uma consulta
abandonada pelo cliente continuaria consumindo o banco.

O estouro de qualquer um deles é tratado como indisponibilidade do banco e
produz `503`, com corpo genérico.

## Transporte cifrado

Quando há TLS, o certificado do servidor é **sempre** verificado. Não existe
caminho no código que produza `rejectUnauthorized: false`, e um teste unitário
percorre todas as configurações possíveis afirmando isso.

`DATABASE_SSL_CA`, quando presente, fixa a autoridade certificadora esperada.
Ausente, valem as autoridades públicas que o Node carrega por padrão.

### A cadeia do RDS, fornecida por `NODE_EXTRA_CA_CERTS`

O certificado servido pelo RDS é emitido por uma autoridade **privada da
Amazon**, que não está entre as autoridades públicas padrão do Node. Como o
código exige `rejectUnauthorized: true` sem exceção, uma implantação que não
forneça essa cadeia **não conecta** — falha fechada, que é o comportamento certo
do ponto de vista de segurança e indisponibilidade total do ponto de vista
operacional.

**O mecanismo é `NODE_EXTRA_CA_CERTS`**, apontando para o pacote de autoridades
que a própria imagem do ambiente de execução já carrega. Uma variável de algumas
dezenas de bytes, sem arquivo para versionar nem rotacionar.

A alternativa — entregar o pacote regional na variável `DATABASE_SSL_CA` — está
descartada por **limite da plataforma**: o conjunto de variáveis de ambiente da
função é limitado a 4 KB agregados, e o pacote regional tem dezenas de KB.

| Mecanismo | Onde vale |
| --- | --- |
| `NODE_EXTRA_CA_CERTS`, para o pacote da imagem do runtime | A implantação |
| `DATABASE_SSL_CA` com o pacote regional | Desenvolvimento local, quando a cadeia precisa ser fixada explicitamente |

A escolha **não exige mudança no código**: o construtor de configuração de
transporte omite a autoridade quando `DATABASE_SSL_CA` está ausente, deixando a
verificação ativa contra o armazém de confiança padrão — que é exatamente o que
`NODE_EXTRA_CA_CERTS` estende.

**O teste de conexão com TLS real contra o endpoint publicado é a verificação
por invocação real da entrega**: ela invoca a função publicada com um evento
sintético e exige recusa de credencial, o que só acontece se a consulta ao banco
tiver ido e voltado. Uma cadeia não fornecida produziria indisponibilidade, e a
entrega reprovaria.

`DATABASE_SSL=false` **desliga o TLS por completo** e é aceito **apenas fora de
produção**: o esquema de configuração recusa a combinação com
`NODE_ENV=production`. Ela existe por uma razão concreta — o PostgreSQL do
ambiente local da API não expõe TLS, e este repositório não pode exigir
alteração naquele. Desligar o transporte cifrado localmente é diferente de
aceitar um certificado não verificado: o segundo nunca acontece.

## O caminho de rede

O banco não é publicamente acessível: `publicly_accessible = false`, subnets
privadas, ingresso restrito à faixa da rede. A função é anexada às **mesmas
subnets privadas**, com grupo de segurança próprio, e alcança o banco por uma
interface de rede criada pela plataforma no momento da partida a frio.

O grupo de segurança da função não declara regra de ingresso — nada conecta nela
— e libera o egresso, que alcança o gerenciador de segredos pelo gateway de
tradução de rede já existente nas rotas privadas.

A criação da interface é o que torna a partida a frio mais cara aqui do que numa
função sem rede, e é a razão de a composição ser **antecipada na inicialização
do ambiente** em vez de esperar a primeira invocação.

## Orçamento de conexões

Cada ambiente de execução mantém **uma** conexão, pelo pool de tamanho um. O
número de conexões simultâneas ao banco é, portanto, o número de ambientes
ativos — e esgotar o limite do banco **derruba a API junto**.

A proteção é a **concorrência reservada em 10**, declarada na configuração da
função. A instância comporta ~110 conexões e a API vai a cinco réplicas com pool
próprio: esta função usa menos de um décimo do orçamento.

Não há intermediador de conexões. Com a reserva, ele deixa de ser necessário
para o volume desta função.

> A reserva pode ser recusada pela conta, que exige ao menos cem execuções não
> reservadas. O caminho de contorno e o seu custo estão em
> [Infraestrutura](terraform.md#configuracao-da-funcao).

## A credencial pode ser trocada sem derrubar a função

A composição é memoizada pela vida do ambiente de execução, e a credencial é
lida **uma única vez**, na inicialização. Quando o banco recusa autenticação, a
composição é **descartada**, e a invocação seguinte relê o segredo.

Sem isso, uma troca de credencial a montante deixaria todo ambiente já aquecido
inutilizável até ser reciclado pela plataforma. A resposta ao chamador não muda:
continua `503`, e a causa não vaza.
