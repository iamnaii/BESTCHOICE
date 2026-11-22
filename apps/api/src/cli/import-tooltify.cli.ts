import { cutoverMain } from './tooltify-cutover.cli';

void cutoverMain(process.argv.slice(2), 'SALES')
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    console.error('CUTOVER_FAILED');
    process.exitCode = 1;
  });
