declare const __GEMIHUB_DESKTOP__: boolean;

interface DesktopProjectFiles {
  read(path: string): Promise<string>;
  create(path: string, content: string | ArrayBuffer): Promise<void>;
  update(path: string, content: string | ArrayBuffer): Promise<void>;
}

interface DesktopPluginAPI {
  projectFiles?: DesktopProjectFiles;
  [key: string]: unknown;
}

export function adaptPluginAPI<T>(input: T): T {
  if (!__GEMIHUB_DESKTOP__) return input;
  const api = input as T & DesktopPluginAPI;
  const files = api.projectFiles;
  if (!files) throw new Error("Audio Score requires GemiHub Desktop 0.8.1 or newer.");
  return Object.assign(api, {
    drive: {
      readFile(path: string) { return files.read(path); },
      async createFile(name: string, content: string | ArrayBuffer) {
        await files.create(name, content);
        return { id: name, name };
      },
      async updateFile(path: string, content: string | ArrayBuffer) { await files.update(path, content); },
    },
  });
}

function decodeProjectContent(content: string): ArrayBuffer {
  const match = content.match(/^data:[^,]*?(;base64)?,(.*)$/s);
  if (!match) return new TextEncoder().encode(content).buffer;
  const decoded = match[1] ? atob(match[2]) : decodeURIComponent(match[2]);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

export async function readPluginBinary(api: { drive: { readFile?(path: string): Promise<string> } }, path: string): Promise<ArrayBuffer> {
  if (!__GEMIHUB_DESKTOP__) {
    const response = await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  if (!api.drive.readFile) throw new Error("Project file reading is unavailable.");
  return decodeProjectContent(await api.drive.readFile(path));
}

export const audioScoreMainViewLocation: "sidebar" | "main" = __GEMIHUB_DESKTOP__ ? "sidebar" : "main";
