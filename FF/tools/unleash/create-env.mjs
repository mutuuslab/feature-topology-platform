import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const secret = () => randomBytes(32).toString('hex');
const values = { PG_ADMIN_PASSWORD: secret(), FF_DB_PASSWORD: secret(), UNLEASH_DB_PASSWORD: secret(), UNLEASH_ADMIN_TOKEN: '*:*.' + secret(), UNLEASH_EDGE_BACKEND_TOKEN: 'default:development.' + secret(), UNLEASH_EDGE_FRONTEND_TOKEN: 'default:development.' + secret(), UNLEASH_ADMIN_PASSWORD: secret() };
writeFileSync(fileURLToPath(new URL('../../docker/unleash/.env', import.meta.url)), Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Created private docker/unleash/.env; values were not printed.');
