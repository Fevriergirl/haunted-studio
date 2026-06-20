import { spawnSync } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const sourceRoots = ['src', 'scripts', 'test'].map((item) => path.join(cwd, item));
const javascriptFiles = (await Promise.all(sourceRoots.map(filesUnder)))
  .flat()
  .filter((file) => file.endsWith('.js'))
  .sort();

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error(`JavaScript syntax check failed: ${path.relative(cwd, file)}`);
  }
}

const jsonFiles = [
  path.join(cwd, 'package.json'),
  path.join(cwd, 'package-lock.json'),
  ...(await filesUnder(path.join(cwd, '.devcontainer'))).filter((file) => file.endsWith('.json')),
  ...(await filesUnder(path.join(cwd, 'config'))).filter((file) => file.endsWith('.json')),
  ...(await filesUnder(path.join(cwd, 'docs'))).filter((file) => file.endsWith('.json')),
  ...(await filesUnder(path.join(cwd, 'observations'))).filter((file) => file.endsWith('.json'))
].sort();

for (const file of jsonFiles) {
  JSON.parse(await readFile(file, 'utf8'));
}

const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(cwd, 'package-lock.json'), 'utf8'));
const expectedRepository = 'git+https://github.com/Fevriergirl/haunted-studio.git';

if (packageJson.name !== 'haunted-studio') throw new Error('Unexpected package name.');
if (packageJson.version !== '0.1.0') throw new Error('Unexpected standalone version.');
if (packageJson.private !== true) throw new Error('The research prototype must remain private to npm.');
if (packageJson.repository?.url !== expectedRepository) throw new Error('Unexpected repository URL.');
if (lock.name !== packageJson.name || lock.version !== packageJson.version) {
  throw new Error('package-lock.json identity does not match package.json.');
}

const rootMarkdown = (await readdir(cwd, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => path.join(cwd, entry.name));
const markdownFiles = [
  ...rootMarkdown,
  ...(await filesUnder(path.join(cwd, 'docs'))).filter((file) => file.endsWith('.md'))
].sort();

let localLinkCount = 0;
for (const file of markdownFiles) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split('#', 1)[0];
    if (!target || /^(https?:|mailto:)/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    await access(resolved);
    localLinkCount += 1;
  }
}

console.log(`Checked ${javascriptFiles.length} JavaScript files, ${jsonFiles.length} JSON files, and ${localLinkCount} local Markdown links.`);
