import { get } from "https";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { dataDir, binDir, ptyWinDir, versionFile } from "./paths.js";
import { detectPlatform } from "./platform.js";

const REPO = "rajan-chari/fellow-agents";

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "fellow-agents-cli" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location!).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} returned HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "fellow-agents-cli" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsDownload(res.headers.location!, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download ${url} returned HTTP ${res.statusCode}`));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

export async function downloadBinaries(force: boolean = false): Promise<string> {
  // Fetch latest release
  const json = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`);
  const release: Release = JSON.parse(json);
  const tag = release.tag_name;

  // Check if up to date
  if (!force && existsSync(versionFile) && existsSync(binDir)) {
    const localVer = readFileSync(versionFile, "utf-8").trim();
    if (localVer === tag) {
      console.log(`  Binaries up to date (${tag})`);
      return tag;
    }
    console.log(`  Update available: ${localVer} → ${tag}`);
  }

  console.log(`  Downloading release ${tag}...`);
  const platform = detectPlatform();
  const matchingAssets = release.assets.filter((asset) => asset.name.includes(platform) || asset.name.includes("pty-win"));
  if (!matchingAssets.some((asset) => asset.name.includes(platform))) {
    throw new Error(`release ${tag} is missing platform asset for ${platform}`);
  }
  if (!matchingAssets.some((asset) => asset.name.includes("pty-win"))) {
    throw new Error(`release ${tag} is missing pty-win asset`);
  }

  for (const asset of matchingAssets) {
    if (asset.name.includes(platform)) {
      console.log(`  Downloading ${asset.name}...`);
      const dest = join(dataDir, asset.name);
      mkdirSync(dirname(dest), { recursive: true });
      await httpsDownload(asset.browser_download_url, dest);
      // Extract zip
      mkdirSync(binDir, { recursive: true });
      extractZip(dest, dataDir);
      rmSync(dest);
      // chmod +x on Linux/Mac
      if (process.platform !== "win32") {
        for (const f of readdirSync(binDir)) {
          try { chmodSync(join(binDir, f), 0o755); } catch {}
        }
      }
    } else if (asset.name.includes("pty-win")) {
      console.log(`  Downloading ${asset.name}...`);
      const dest = join(dataDir, asset.name);
      mkdirSync(dirname(dest), { recursive: true });
      // Remove old node_modules before extracting new pty-win
      const nodeModules = join(ptyWinDir, "node_modules");
      if (existsSync(nodeModules)) rmSync(nodeModules, { recursive: true });
      await httpsDownload(asset.browser_download_url, dest);
      extractZip(dest, dataDir);
      rmSync(dest);
    }
  }

  // Save version
  mkdirSync(join(dataDir, "bin"), { recursive: true });
  writeFileSync(versionFile, tag, "utf-8");
  return tag;
}

function extractZip(zipPath: string, destDir: string): void {
  // Use tar on all platforms (Windows 10+ has tar built in)
  try {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: "pipe" });
  } catch {
    // Fallback: PowerShell on Windows
    if (process.platform === "win32") {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: "pipe" });
    } else {
      execSync(`unzip -qo "${zipPath}" -d "${destDir}"`, { stdio: "pipe" });
    }
  }
}
