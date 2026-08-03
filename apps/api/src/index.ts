import { start } from './app.js';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
