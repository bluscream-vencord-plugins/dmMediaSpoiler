/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { defineDefault, OptionType } from "@utils/types";
import { Checkbox, MessageStore } from "@webpack/common";

import { pluginInfo } from "./info";

export const emitChange = () => MessageStore.emitChange();

let watchersCallback: (() => void) | null = null;
export function registerWatchersCallback(cb: (() => void) | null) {
    watchersCallback = cb;
}

const onSettingChange = () => {
    emitChange();
    watchersCallback?.();
};

const CONCEAL_LABELS = {
    media: "Images and videos",
    stickers: "Stickers",
    files: "Files, audio and voice messages",
    linkPreviews: "Media link previews",
    text: "Message text",
    emojis: "Emojis",
} as const;

export type ConcealType = keyof typeof CONCEAL_LABELS;

const DEFAULT_CONCEAL: Record<ConcealType, boolean> = {
    media: true,
    stickers: true,
    files: false,
    linkPreviews: false,
    text: false,
    emojis: false,
};

function ConcealCheckbox({ type }: { type: ConcealType; }) {
    const { conceal } = settings.use(["conceal"]);

    return (
        <Checkbox
            value={conceal[type]}
            onChange={(_, value) => {
                settings.store.conceal[type] = value;
                emitChange();
            }}
            size={20}
        >
            <BaseText size="sm">{CONCEAL_LABELS[type]}</BaseText>
        </Checkbox>
    );
}

const ConcealSettings = ErrorBoundary.wrap(() => (
    <SettingsSection name="What to conceal" id="conceal" description="Pick what gets covered in DMs while concealing is active.">
        {(Object.keys(CONCEAL_LABELS) as ConcealType[]).map(type => <ConcealCheckbox key={type} type={type} />)}
    </SettingsSection>
));

const stored = SettingsStore.plain.plugins[pluginInfo.name];
for (const [oldKey, type] of [["hideMediaLinkPreviews", "linkPreviews"], ["spoilerStickers", "stickers"]] as const) {
    if (!stored || !Object.hasOwn(stored, oldKey)) continue;
    stored.conceal = { ...DEFAULT_CONCEAL, ...stored.conceal, [type]: stored[oldKey] };
    delete stored[oldKey];
    SettingsStore.markAsChanged();
}

export const settings = definePluginSettings({
    concealInStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Conceal while Discord Streamer Mode is enabled.",
        default: true,
        onChange: emitChange,
    },
    concealWhileStreaming: {
        type: OptionType.BOOLEAN,
        description: "Conceal while you have an active Discord stream, even when Streamer Mode is disabled.",
        default: true,
        onChange: emitChange,
    },
    forceDiscordStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable Discord's native Streamer Mode whenever an active stream/screencast is detected.",
        default: true,
        onChange: onSettingChange,
    },
    detectPipewireWatcher: {
        type: OptionType.BOOLEAN,
        description: "Conceal when an active screen capture is detected via the local PipeWire watcher daemon.",
        default: true,
        onChange: onSettingChange,
    },
    pipewireWatcherUrl: {
        type: OptionType.STRING,
        description: "URL of the local PipeWire screencast watcher daemon.",
        default: "http://127.0.0.1:28282",
        onChange: onSettingChange,
    },
    detectObs: {
        type: OptionType.BOOLEAN,
        description: "Conceal when OBS Studio is actively streaming or recording (via OBS-WebSocket).",
        default: true,
        onChange: onSettingChange,
    },
    obsAddress: {
        type: OptionType.STRING,
        description: "OBS-WebSocket address (default in OBS v28+ is ws://127.0.0.1:4455).",
        default: "ws://127.0.0.1:4455",
        onChange: onSettingChange,
    },
    obsPassword: {
        type: OptionType.STRING,
        description: "OBS-WebSocket password (leave blank if password is disabled in OBS Tools -> WebSocket Server Settings).",
        default: "",
        onChange: onSettingChange,
    },
    obsIncludeRecording: {
        type: OptionType.BOOLEAN,
        description: "Also conceal while recording locally in OBS.",
        default: false,
        onChange: onSettingChange,
    },
    obsIncludeVirtualCam: {
        type: OptionType.BOOLEAN,
        description: "Also conceal while OBS Virtual Camera is running.",
        default: false,
        onChange: onSettingChange,
    },
    conceal: {
        type: OptionType.COMPONENT,
        component: ConcealSettings,
        default: defineDefault(DEFAULT_CONCEAL),
    },
    includeGroupDms: {
        type: OptionType.BOOLEAN,
        description: "Also conceal in group DMs.",
        default: true,
        onChange: emitChange,
    },
});
