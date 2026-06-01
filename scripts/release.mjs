#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerHubImage = "zhiyingzzhou/renewlet";
const ghcrImage = "ghcr.io/zhiyingzzhou/renewlet";
const versionPattern = /^v?(?<version>\d+\.\d+\.\d+(?:-rc\.(?<rc>\d+))?)$/;
const stablePattern = /^v?\d+\.\d+\.\d+$/;
const packagePaths = [
  "package.json",
  "packages/client/package.json",
  "packages/cloudflare/package.json",
  "packages/server/package.json",
  "packages/shared/package.json",
];

function usage() {
  console.log(`Usage:
  node scripts/release.mjs validate-version <version>
  node scripts/release.mjs sync-version <version>
  node scripts/release.mjs notes --version <version> [--previous <tag>]
  node scripts/release.mjs docker-tags <version>
  node scripts/release.mjs package-docker <version>
  node scripts/release.mjs release-body --version <version> [--previous <tag>]`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(value);
    }
  }
  return args;
}

function normalizeVersion(rawVersion) {
  const match = versionPattern.exec(rawVersion ?? "");
  if (!match?.groups?.version) {
    fail(`Invalid version "${rawVersion}". Expected 0.1.0 or v0.1.0, with optional -rc.N.`);
  }
  return match.groups.version;
}

function isStableVersion(version) {
  return stablePattern.test(version);
}

function majorMinor(version) {
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function syncVersion(rawVersion) {
  const version = normalizeVersion(rawVersion);
  if (!isStableVersion(version)) {
    // package.json 是稳定线元数据；RC 只靠 tag 表达，避免源码版本在候选版之间来回抖动。
    fail("Package versions must stay on the stable SemVer value. Do not sync an RC suffix into package.json.");
  }

  for (const relativePath of packagePaths) {
    const path = join(repoRoot, relativePath);
    const packageJson = readJson(path);
    packageJson.version = version;
    writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  console.log(`Synced workspace package versions to ${version}.`);
}

function commitRange(previous) {
  if (previous) {
    return `${previous}..HEAD`;
  }

  try {
    const latestTag = runGit(["describe", "--tags", "--abbrev=0"]);
    return `${latestTag}..HEAD`;
  } catch {
    return "HEAD";
  }
}

function compareLink(previous, version) {
  if (previous) {
    return `https://github.com/zhiyingzzhou/renewlet/compare/${previous}...v${version}`;
  }

  try {
    // 首个 release 没有上一个 tag，只能退回 tag 页；后续 release 会生成真实 compare 链接。
    const latestTag = runGit(["describe", "--tags", "--abbrev=0", "HEAD^"]);
    return `https://github.com/zhiyingzzhou/renewlet/compare/${latestTag}...v${version}`;
  } catch {
    return `https://github.com/zhiyingzzhou/renewlet/releases/tag/v${version}`;
  }
}

function changelogSection(rawVersion) {
  const version = normalizeVersion(rawVersion);
  // RC 复用稳定版短 notes，避免候选版页面因为 0.1.0-rc.N 没有独立 changelog 段而空白。
  const stableVersion = version.replace(/-rc\.\d+$/, "");
  const changelogPath = join(repoRoot, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    return "";
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const versionHeader = new RegExp(`^##\\s+${stableVersion}(?:\\s+-\\s+[^\\n]+)?\\s*$`, "m");
  const match = versionHeader.exec(changelog);
  if (!match) {
    return "";
  }

  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const nextHeader = rest.search(/^##\s+/m);
  return (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
}

function markdownNotes(rawVersion, previous) {
  const version = normalizeVersion(rawVersion);
  const notes = changelogSection(version);
  const lines = [];

  if (notes) {
    lines.push(notes, "");
  } else {
    lines.push("### Highlights", "", "- Add concise release highlights before publishing this draft.", "");
  }

  lines.push("### Full Changelog", "", `- ${compareLink(previous, version)}`, "");
  return lines.join("\n");
}

function dockerTags(rawVersion) {
  const version = normalizeVersion(rawVersion);
  const tags = [];

  if (isStableVersion(version)) {
    // latest 只随稳定版移动；RC 用户必须显式选择 rc 或具体候选标签。
    tags.push(
      `${dockerHubImage}:${version}`,
      `${dockerHubImage}:${majorMinor(version)}`,
      `${dockerHubImage}:latest`,
      `${ghcrImage}:${version}`,
      `${ghcrImage}:${majorMinor(version)}`,
      `${ghcrImage}:latest`,
    );
  } else {
    tags.push(`${dockerHubImage}:${version}`, `${dockerHubImage}:rc`, `${ghcrImage}:${version}`, `${ghcrImage}:rc`);
  }

  return tags;
}

function releaseBody(rawVersion, previous) {
  const version = normalizeVersion(rawVersion);
  const stable = isStableVersion(version);
  const tags = dockerTags(version);
  const dockerHubTags = tags.filter((tag) => tag.startsWith(`${dockerHubImage}:`));
  const ghcrTags = tags.filter((tag) => tag.startsWith(`${ghcrImage}:`));
  const notes = markdownNotes(version, previous).trimEnd();

  return [
    "## Docker images",
    "",
    "- Docker Hub",
    ...dockerHubTags.map((tag) => `  - \`${tag}\``),
    "- GitHub Container Registry",
    ...ghcrTags.map((tag) => `  - \`${tag}\``),
    "",
    "## Upgrade",
    "",
    "Back up `.env`, `docker-compose.yml`, and `data/` before upgrading. Production deployments should pin a concrete version tag; `latest` only moves on stable releases.",
    "",
    stable
      ? "This is a stable release. The `latest` Docker tag is updated after the image build succeeds."
      : "This is a release candidate. It does not update `latest` and is intended for validation before the stable release.",
    "",
    "## Changelog",
    "",
    notes,
    "",
  ].join("\n");
}

function patchDockerImage(content, version) {
  // Release 附件必须 pin 当前版本，避免用户下载旧 Release 后被 latest 带到未来版本。
  return content
    .replace(/zhiyingzzhou\/renewlet:latest/g, `${dockerHubImage}:${version}`)
    .replace(/ghcr\.io\/zhiyingzzhou\/renewlet:latest/g, `${ghcrImage}:${version}`);
}

function packageDocker(rawVersion) {
  const version = normalizeVersion(rawVersion);
  const tempDir = mkdtempSync(join(tmpdir(), "renewlet-release-"));
  const packageDir = join(tempDir, `renewlet-docker-v${version}`);
  const outputDir = join(repoRoot, "tmp", "release");
  const zipPath = join(outputDir, `renewlet-docker-v${version}.zip`);

  mkdirSync(packageDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const files = ["docker-compose.yml", "env.example", "docker-deploy.sh"];
  for (const file of files) {
    const source = join(repoRoot, "deploy", file);
    const target = join(packageDir, file);
    const content = readFileSync(source, "utf8");
    writeFileSync(target, patchDockerImage(content, version));
    if (file === "docker-deploy.sh") {
      chmodSync(target, 0o755);
    }
  }

  try {
    if (existsSync(zipPath)) {
      rmSync(zipPath);
    }
    execFileSync("zip", ["-qr", zipPath, basename(packageDir)], {
      cwd: tempDir,
      stdio: "inherit",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(zipPath);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

switch (command) {
  case "validate-version": {
    const version = normalizeVersion(args._[1]);
    console.log(version);
    break;
  }
  case "sync-version":
    syncVersion(args._[1]);
    break;
  case "notes":
    process.stdout.write(markdownNotes(args.version, args.previous));
    break;
  case "docker-tags":
    process.stdout.write(`${dockerTags(args._[1]).join("\n")}\n`);
    break;
  case "package-docker":
    packageDocker(args._[1]);
    break;
  case "release-body":
    process.stdout.write(releaseBody(args.version, args.previous));
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
