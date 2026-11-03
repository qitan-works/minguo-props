import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const root = new URL('../', import.meta.url);

describe('Dependabot 與 Node 版本', () => {
  it('npm 的更新忽略 @types/node 的主版本升級', async () => {
    const yml = await readFile(new URL('.github/dependabot.yml', root), 'utf8');
    const npm = yml.slice(yml.indexOf('package-ecosystem: npm'), yml.indexOf('package-ecosystem: github-actions'));
    assert.match(npm, /ignore:\s*\n(?:\s*#[^\n]*\n)*\s*- dependency-name: '@types\/node'\s*\n\s*update-types: \['version-update:semver-major'\]/);
    assert.match(npm, /Node 24/, '要有註解說明原因');
  });

  it('@types/node 的主版本和執行環境（engines、CI）的 Node 主版本一致', async () => {
    const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { engines: { node: string }; devDependencies: Record<string, string> };
    const engineMajor = Number(/(\d+)/.exec(pkg.engines.node)?.[1]);
    const typesMajor = Number(pkg.devDependencies['@types/node']?.split('.')[0]);
    assert.equal(typesMajor, engineMajor);
    for (const wf of ['ci.yml', 'pages.yml']) {
      const text = await readFile(new URL(`.github/workflows/${wf}`, root), 'utf8');
      assert.match(text, new RegExp(`node-version: ${engineMajor}\\b`), wf);
    }
  });
});
