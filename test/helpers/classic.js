import fs from 'node:fs';
import vm from 'node:vm';

export function loadClassic(url, sandbox = {}) {
  const code = fs.readFileSync(url, 'utf8');
  const context = vm.createContext({ console, ...sandbox });
  vm.runInContext(code, context, { filename: url.pathname });
  return context;
}
