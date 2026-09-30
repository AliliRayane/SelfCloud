import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 3000),
  data: path.resolve(process.env.DATA_DIR || 'data'),
  setupToken: process.env.SETUP_TOKEN || '',
  origin: process.env.PUBLIC_ORIGIN || '',
  secureCookies: process.env.SECURE_COOKIES === 'true',
  trustProxy: Number(process.env.TRUST_PROXY || 0),
};
