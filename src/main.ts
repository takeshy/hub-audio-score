/**
 * Audio Score - Audio to Sheet Music Plugin for GemiHub
 *
 * Analyzes audio files using FFT-based pitch detection and
 * renders detected notes as sheet music on a canvas staff.
 */

import { ScorePanel } from "./ui/ScorePanel";
import { SettingsPanel } from "./ui/SettingsPanel";
import { MainView } from "./ui/MainView";
import { adaptPluginAPI, audioScoreMainViewLocation } from "./host";

interface PluginAPI {
  registerView(view: {
    id: string;
    name: string;
    icon?: string;
    location: "sidebar" | "main";
    extensions?: string[];
    component: unknown;
  }): void;
  registerSettingsTab(tab: {
    component: unknown;
  }): void;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  drive: {
    createFile(name: string, content: string): Promise<{ id: string; name: string }>;
  };
}

class AudioScorePlugin {
  onload(hostAPI: PluginAPI): void {
    const api = adaptPluginAPI(hostAPI);
    api.registerView({
      id: "audio-score",
      name: "Audio Score",
      location: "sidebar",
      component: ScorePanel,
    });

    api.registerView({
      id: "audio-score-main",
      name: "Audio Score",
      location: audioScoreMainViewLocation,
      extensions: [".audioscore", ".mid", ".midi"],
      component: MainView,
    });

    api.registerSettingsTab({
      component: SettingsPanel,
    });
  }

  onunload(): void {
    // cleanup handled by host
  }
}

module.exports = AudioScorePlugin;
