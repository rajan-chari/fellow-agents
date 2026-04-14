import { platform, arch } from "os";

export type Platform = "win-x64" | "osx-arm64" | "osx-x64" | "linux-x64";

export function detectPlatform(): Platform {
  const os = platform();
  const cpu = arch();
  if (os === "win32") return "win-x64";
  if (os === "darwin") return cpu === "arm64" ? "osx-arm64" : "osx-x64";
  if (os === "linux") return "linux-x64";
  throw new Error(`Unsupported platform: ${os}-${cpu}`);
}

export function binarySuffix(): string {
  return platform() === "win32" ? ".exe" : "";
}
