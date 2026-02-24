import { glob } from 'glob';
const waybackDir = process.argv[2];
import { spawn } from 'child_process';

if (!waybackDir) {
  console.error(
    'Please provide a Wayback Machine base directory to scan'
  );
  process.exit(1);
}

const pattern = `scraped-output/${waybackDir}*`;
const matches = await glob(pattern, { ignore: 'node_modules/**' });

if (matches.length < 1) {
  console.error(`No scraped matches found for "${waybackDir}"`);
} else {
  const child = spawn(
    'http-server',
    [`${matches[0]}/${waybackDir}`],
    { stdio: 'inherit' }
  );

  child.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  child.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });

  process.on('SIGINT', () => {
    console.log('Received SIGINT. Terminating child process...');
    // Kill the child process and all its descendants
    kill(child.pid, 'SIGINT', (err) => {
      if (err) {
        console.error('Failed to kill child process:', err);
      } else {
        console.log('Child process terminated.');
      }
      process.exit(); // Exit the parent process
    });
  });
}
