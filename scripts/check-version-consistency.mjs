import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const sources = [
  {
    file: "backend/pyproject.toml",
    pattern: /^version = "([^"]+)"$/m,
  },
  {
    file: "backend/src/better_data/__init__.py",
    pattern: /^__version__ = "([^"]+)"$/m,
  },
  {
    file: "backend/tests/test_health.py",
    pattern: /"version": "([^"]+)"/,
  },
];

const expected = packageJson.version;
const mismatches = [];

for (const source of sources) {
  const content = await readFile(source.file, "utf8");
  const match = content.match(source.pattern);
  const actual = match?.[1];
  if (actual !== expected) mismatches.push(`${source.file}: ${actual ?? "未找到版本"}`);
}

if (mismatches.length > 0) {
  process.stderr.write(`版本不一致，package.json 为 ${expected}：\n${mismatches.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`版本一致：${expected}\n`);
}
