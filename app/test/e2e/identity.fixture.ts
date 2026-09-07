import { Pool } from 'pg';

export interface IdentitySeed {
  cpf: string;
  passwordHash: string;
  userActive?: boolean;
  customers?: { active: boolean }[];
}

export interface SeededIdentity {
  userId: string;
  customerIds: string[];
}

export async function seedIdentity(pool: Pool, seed: IdentitySeed): Promise<SeededIdentity> {
  const suffix = Math.random().toString(36).slice(2, 10);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (id, name, email, cpf, password_hash, role, is_active, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL, $5, now(), now())
     RETURNING id`,
    [
      `Usuário ${suffix}`,
      `usuario-${suffix}@exemplo.local`,
      seed.cpf,
      seed.passwordHash,
      seed.userActive ?? true,
    ],
  );

  const userId = rows[0].id;
  const customerIds: string[] = [];

  for (const [index, customer] of (seed.customers ?? []).entries()) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO customers (id, name, document, type, email, phone, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'COMPANY', $3, $4, $5, now(), now())
       RETURNING id`,
      [
        `Cliente ${suffix}-${index}`,
        `${Date.now()}${index}`.slice(-14).padStart(14, '9'),
        `cliente-${suffix}-${index}@exemplo.local`,
        '11999999999',
        customer.active,
      ],
    );

    const customerId = inserted.rows[0].id;

    await pool.query(
      `INSERT INTO user_customers (user_id, customer_id, created_at) VALUES ($1, $2, now())`,
      [userId, customerId],
    );

    customerIds.push(customerId);
  }

  return { userId, customerIds };
}

export async function clearIdentity(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM user_customers');
  await pool.query('DELETE FROM users WHERE cpf IS NOT NULL');
  await pool.query("DELETE FROM customers WHERE email LIKE '%@exemplo.local'");
}
