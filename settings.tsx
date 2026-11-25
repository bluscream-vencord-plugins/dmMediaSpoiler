/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { parseUrl } from "@utils/misc";
import { defineDefault, OptionType } from "@utils/types";
import { Checkbox } from "@webpack/common";

import { pluginInfo } from "./info";
import { PATTERNS } from "./patterns";

let settingsCallback: ((key: SettingKey) => void) | null = null;
export function registerSettingsCallback(cb: ((key: SettingKey) => void) | null) {
    settingsCallback = cb;
}

const onChange = (key: SettingKey) => () => settingsCallback?.(key);

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
                settingsCallback?.("conceal");
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

function validUrl(protocols: readonly string[]) {
    return (value: string) => {
        if (!value.trim()) return true;
        const url = parseUrl(value.trim());
        if (!url || !protocols.includes(url.protocol)) return `Enter an address starting with ${protocols.map(p => p + "//").join(" or ")}.`;
        return true;
    };
}

export const settings = definePluginSettings({
    concealInStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Conceal while Discord Streamer Mode is enabled.",
        default: true,
        onChange: onChange("concealInStreamerMode"),
    },
    concealWhileStreaming: {
        type: OptionType.BOOLEAN,
        description: "Conceal while you have an active Discord stream, even when Streamer Mode is disabled.",
        default: true,
        onChange: onChange("concealWhileStreaming"),
    },
    forceDiscordStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Turn on Discord's Streamer Mode when a stream or screen capture starts, and off again when it ends.",
        default: true,
        onChange: onChange("forceDiscordStreamerMode"),
    },
    detectPipewireWatcher: {
        type: OptionType.BOOLEAN,
        description: "Conceal while the local PipeWire watcher helper reports a screen capture.",
        default: true,
        onChange: onChange("detectPipewireWatcher"),
    },
    pipewireWatcherUrl: {
        type: OptionType.STRING,
        description: "Address of the local PipeWire watcher helper.",
        default: PATTERNS.pipewire.defaultUrl,
        isValid: validUrl(PATTERNS.pipewire.protocols),
        onChange: onChange("pipewireWatcherUrl"),
    },
    detectObs: {
        type: OptionType.BOOLEAN,
        description: "Conceal while OBS Studio is streaming, read through OBS WebSocket.",
        default: true,
        onChange: onChange("detectObs"),
    },
    obsAddress: {
        type: OptionType.STRING,
        description: "OBS WebSocket address. OBS 28 and newer use ws://127.0.0.1:4455 by default.",
        default: PATTERNS.obs.defaultAddress,
        isValid: validUrl(PATTERNS.obs.protocols),
        onChange: onChange("obsAddress"),
    },
    obsPassword: {
        type: OptionType.STRING,
        description: "OBS WebSocket password. Leave it empty when authentication is off in OBS's WebSocket Server Settings.",
        default: "",
        onChange: onChange("obsPassword"),
    },
    obsIncludeRecording: {
        type: OptionType.BOOLEAN,
        description: "Also conceal while recording locally in OBS.",
        default: false,
        onChange: onChange("obsIncludeRecording"),
    },
    obsIncludeVirtualCam: {
        type: OptionType.BOOLEAN,
        description: "Also conceal while the OBS Virtual Camera is running.",
        default: false,
        onChange: onChange("obsIncludeVirtualCam"),
    },
    conceal: {
        type: OptionType.COMPONENT,
        component: ConcealSettings,
        default: defineDefault({ ...DEFAULT_CONCEAL }),
    },
    includeGroupDms: {
        type: OptionType.BOOLEAN,
        description: "Also conceal in group DMs.",
        default: true,
        onChange: onChange("includeGroupDms"),
    },
}).withPrivateSettings<{ streamerModeEnabledByPlugin?: boolean; }>();

export type SettingKey = "concealInStreamerMode" | "concealWhileStreaming" | "forceDiscordStreamerMode" | "detectPipewireWatcher"
    | "pipewireWatcherUrl" | "detectObs" | "obsAddress" | "obsPassword" | "obsIncludeRecording" | "obsIncludeVirtualCam" | "conceal" | "includeGroupDms";
