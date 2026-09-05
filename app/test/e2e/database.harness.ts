import { GenericContainer, Network, StartedNetwork, Wait } from 'testcontainers';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Imagem da API, usada como **migrador de uma passada**. O schema pertence
 * àquele repositório; este apenas o invoca
 * A imagem é produzida no repositório da API com `docker compose build migrate`.
 */
export const API_MIGRATOR_IMAGE = process.env.API_MIGRATOR_IMAGE ?? 'techchallenge-api:local';

const POSTGRES_IMAGE = 'postgres:16-alpine';
const NETWORK_ALIAS = 'db';
const DATABASE = 'techchallenge';
const USERNAME = 'postgres';
const PASSWORD = 'postgres';

export interface MigratedDatabase {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  internalUrl: string;
  network: StartedNetwork;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/**
 * Sobe um PostgreSQL efêmero e aplica **as migrations mantidas pela API**,
 * seguidas do seed dela. O que sai daqui é o schema real, não uma cópia.
 */
export async function startMigratedDatabase(): Promise<MigratedDatabase> {
  const network = await new Network().start();

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE)
    .withUsername(USERNAME)
    .withPassword(PASSWORD)
    .withNetwork(network)
    .withNetworkAliases(NETWORK_ALIAS)
    .start();

  const internalUrl = `postgresql://${USERNAME}:${PASSWORD}@${NETWORK_ALIAS}:5432/${DATABASE}?schema=public`;

  const migrator = await new GenericContainer(API_MIGRATOR_IMAGE)
    .withNetwork(network)
    .withEnvironment({ DATABASE_URL: internalUrl })
    .withCommand(['sh', '-c', 'npx prisma migrate deploy && npx prisma db seed'])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(180_000)
    .start();

  await migrator.stop();

  return {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: DATABASE,
    username: USERNAME,
    password: PASSWORD,
    internalUrl,
    network,
    container,
    stop: async () => {
      await container.stop();
      await network.stop();
    },
  };
}
