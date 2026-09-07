# Banco de dados

A função é **somente leitura** e **não é dona do schema**.

## O schema pertence à API

Este repositório **não contém** definição de schema, migration ou qualquer DDL —
nem em código de produção, nem em código de teste. As tabelas `users`,
`user_customers` e `customers` são mantidas pela API principal
(`oficina-mecanica-app`), e qualquer necessidade de alteração é endereçada
naquele repositório.

Onde um banco com o schema real é necessário — desenvolvimento local e a suíte
de ponta a ponta —, ele é obtido **executando as migrations da API**, pela
imagem dela. Rodar contra uma definição criada aqui provaria apenas
que a função concorda consigo mesma, que é justamente o defeito a detectar.

> **Dependência de entrega.** A consulta abaixo lê `users.cpf`,
> `customers.is_active` e a tabela `user_customers`, introduzidas pela change da
> API que cria a identidade externa. Ela vive na branch `feature/login-cpf`
> (PR 65) e ainda não foi integrada: enquanto isso, a imagem migradora precisa
> vir dessa branch. Contra qualquer schema anterior, a suíte de ponta a ponta
> desta função falha — por projeto: é exatamente o sinal que ela existe para dar.

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

### A cadeia do RDS precisa ser fornecida — requisito da change de infraestrutura

O certificado servido pelo RDS é emitido por uma autoridade **privada da
Amazon**, que não está entre as autoridades públicas padrão do Node. Como o
código exige `rejectUnauthorized: true` sem exceção, uma implantação que não
forneça essa cadeia **não conecta** — falha fechada, que é o comportamento certo
do ponto de vista de segurança e indisponibilidade total do ponto de vista
operacional.

Fornecer a cadeia é obrigatório e a change de infraestrutura MUST escolher e
exercitar **um** destes mecanismos:

| Mecanismo | Como |
| --- | --- |
| Variável de ambiente (preferido) | `NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`, usando o pacote que a própria imagem do runtime já traz — nenhum arquivo para versionar ou rotacionar |
| CA explícita | Baixar o pacote regional de `https://truststore.pki.rds.amazonaws.com/<região>/<região>-bundle.pem` e entregá-lo em `DATABASE_SSL_CA` |

`DATABASE_SSL_CA` continua opcional **no esquema** porque o primeiro mecanismo
dispensa a variável. O que não é opcional é a decisão: sem um dos dois, a função
sobe e falha na primeira consulta. Um teste de conexão com TLS real contra o
endpoint publicado é o que fecha esse item.

`DATABASE_SSL=false` **desliga o TLS por completo** e é aceito **apenas fora de
produção**: o esquema de configuração recusa a combinação com
`NODE_ENV=production`. Ela existe por uma razão concreta — o PostgreSQL do
ambiente local da API não expõe TLS, e este repositório não pode exigir
alteração naquele. Desligar o transporte cifrado localmente é diferente de
aceitar um certificado não verificado: o segundo nunca acontece.

## Dívidas assumidas

**Privilégio acima do necessário.** A concessão de menor privilégio depende de
migration, que pertence à API, e foi adiada. A função conectará com uma role
existente e mais privilegiada do que precisa. Mitigação: ela é somente leitura
por construção e executa uma consulta conhecida. A restrição fica registrada
como dívida, com dono nomeado na change de infraestrutura.

**Sem intermediador de conexões.** Sem um intermediador, o número de conexões
simultâneas ao banco é o número de ambientes de execução ativos — e esgotar o
limite do banco **derruba a API junto**. A concorrência reservada passa a ser a
única proteção, e isso precisa constar do plano da change de infraestrutura, não
ser descoberto em produção.

Se aquela change adotar um intermediador com autenticação por identidade da
nuvem, a função ganha uma dependência para gerar credencial temporária. Isso não
altera camadas nem specs, mas precisa ser decidido **antes** daquela change.
