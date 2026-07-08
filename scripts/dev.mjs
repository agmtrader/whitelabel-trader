import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(
      `[dev] ${name} exited unexpectedly${signal ? ` with signal ${signal}` : ` with code ${code}`}`
    );
    shutdown(typeof code === 'number' ? code : 1);
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(exitCode);
  }, 1000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting trader server and Expo web');
startProcess('trader-server', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'server']);
startProcess('expo-web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'web']);
