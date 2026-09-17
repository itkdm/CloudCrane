import { createAuth } from '@cloudcrane/auth';
import { createPlatformDb } from '@cloudcrane/db';

const platform = createPlatformDb();
export const auth = createAuth(platform.db);
export const authDb = platform.db;
