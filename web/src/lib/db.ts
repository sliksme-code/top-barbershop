import postgres from 'postgres';

// Прямое чтение каталога из Postgres (тот же, что у Directus). Пул на процесс.
const url = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/tb';
export const sql = postgres(url, { max: 8, idle_timeout: 30, prepare: true, transform: { undefined: null } });
