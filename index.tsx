/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { migratePluginSetting } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { proxyLazy } from "@utils/lazy";
import definePlugin from "@utils/types";
import { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, FluxDispatcher, lodash, MessageStore, SelectedChannelStore, StreamerModeStore } from "@webpack/common";
import type { ReactNode } from "react";

import { Watcher } from "./backoff";
import { pluginInfo } from "./info";
import { startObsWatcher } from "./obs";
import { PATTERNS } from "./patterns";
import { startPipewireWatcher } from "./pipewire";
import { registerSettingsCallback, SettingKey, settings } from "./settings";

export { pluginInfo };

interface SpoilerProps {
    type: "text" | "attachment" | "embed";
    inline?: boolean;
    children(hidden: boolean): ReactNode;
}

const Spoiler = findComponentByCodeLazy<SpoilerProps>(...PATTERNS.webpack.spoilerComponent);

type FlaggedAttachment = MessageAttachment & { flags?: number; };

migratePluginSetting(pluginInfo.name, "concealInStreamerMode", "onlyWhenStreamerModeEnabled");

let isPipewireStreaming = false;
let isObsStreaming = false;
let pipewire: Watcher | null = null;
let obs: Watcher | null = null;
let wasStreaming = false;
let concealActive = false;
let concealGeneration = 0;
const spoileredMessages = new WeakMap<Message, { generation: number; message: Message; }>();

function isAnyStreamingActive(): boolean {
    const { detectPipewireWatcher, detectObs, concealWhileStreaming } = settings.store;
    return (detectPipewireWatcher && isPipewireStreaming)
        || (detectObs && isObsStreaming)
        || (concealWhileStreaming && ApplicationStreamingStore.getCurrentUserActiveStream() != null);
}

function setStreamerMode(value: boolean) {
    FluxDispatcher.dispatch({ type: PATTERNS.streamerModeUpdate, key: "enabled", value });
}

function updateDiscordStreamerMode() {
    const streaming = isAnyStreamingActive();
    const force = settings.store.forceDiscordStreamerMode;

    if (force && streaming && !wasStreaming && !StreamerModeStore.enabled) {
        settings.store.streamerModeEnabledByPlugin = true;
        setStreamerMode(true);
    } else if ((!force || !streaming) && settings.store.streamerModeEnabledByPlugin) {
        settings.store.streamerModeEnabledByPlugin = false;
        if (StreamerModeStore.enabled) setStreamerMode(false);
    }
    wasStreaming = streaming;
}

function invalidate() {
    concealGeneration++;
    MessageStore.emitChange();
}

function refreshConceal() {
    updateDiscordStreamerMode();
    const active = (settings.store.concealInStreamerMode && StreamerModeStore.enabled) || isAnyStreamingActive();
    if (active === concealActive) return;
    concealActive = active;
    invalidate();
}

function concealsIn(channel: Channel | undefined): boolean {
    return concealActive && channel != null && (channel.isDM() || (settings.store.includeGroupDms && channel.isGroupDM()));
}

const channelOf = (message: Message) => ChannelStore.getChannel(message.channel_id ?? SelectedChannelStore.getChannelId());

type Embed = Message["embeds"][number];

const embedHasText = (embed: Embed) => !!(embed.rawTitle || embed.rawDescription || embed.author?.name || embed.footer?.text || embed.provider?.name || embed.fields?.length);
const embedHasIcon = (embed: Embed) => !!(embed.author?.iconURL || embed.footer?.iconURL);

function concealsWholeEmbeds(message: Message, channel: Channel | undefined): boolean {
    const { text, linkPreviews } = settings.store.conceal;
    if ((!text && !linkPreviews) || !message.embeds?.length || !concealsIn(channel)) return false;
    return message.embeds.some(embed => (text && embedHasText(embed)) || (linkPreviews && embedHasIcon(embed)));
}

function shouldSpoilerEmbed(embed: Embed, message: Message): boolean {
    if (!settings.store.conceal.linkPreviews || (embed.image == null && embed.video == null && embed.thumbnail == null && !embed.images?.length)) return false;
    const channel = channelOf(message);
    return concealsIn(channel) && !concealsWholeEmbeds(message, channel);
}

function isConcealedAttachment(attachment: MessageAttachment) {
    const isMedia = attachment.content_type
        ? PATTERNS.mediaContentType.test(attachment.content_type)
        : PATTERNS.mediaFileName.test(attachment.filename);
    return settings.store.conceal[isMedia ? "media" : "files"];
}

function withSpoilerAttachments(message: Message, channel: Channel): Message {
    if (!concealsIn(channel) || !message.attachments.some(isConcealedAttachment)) return message;

    const cached = spoileredMessages.get(message);
    if (cached?.generation === concealGeneration) return cached.message;

    const attachments = message.attachments.map((attachment: FlaggedAttachment) => isConcealedAttachment(attachment) ? {
        ...attachment,
        spoiler: true,
        flags: (attachment.flags ?? 0) | PATTERNS.attachmentSpoilerFlag,
    } : attachment);
    const spoilered: Message = Object.create(message, { attachments: { value: attachments, enumerable: true } });
    spoileredMessages.set(message, { generation: concealGeneration, message: spoilered });
    return spoilered;
}

interface ASTNode {
    type: string;
    content?: string | ASTNode[];
    channelId?: string;
}

const spoilerNode = (content: ASTNode[], channelId: string): ASTNode => ({ type: PATTERNS.ast.spoiler, content, channelId });

function spoilerEmojis(nodes: ASTNode[], channelId: string): ASTNode[] {
    return nodes.map(node =>
        PATTERNS.ast.emojis.includes(node.type) ? spoilerNode([node], channelId)
            : node.type !== PATTERNS.ast.spoiler && Array.isArray(node.content) ? { ...node, content: spoilerEmojis(node.content, channelId) }
                : node
    );
}

function spoilerContent(ast: ASTNode[], message: Message): ASTNode[] {
    const { text, emojis } = settings.store.conceal;
    if ((!text && !emojis) || !ast.length) return ast;

    const channel = channelOf(message);
    if (!channel || !concealsIn(channel)) return ast;

    if (!text) return spoilerEmojis(ast, channel.id);
    return ast.length === 1 && ast[0].type === PATTERNS.ast.spoiler ? ast : [spoilerNode(ast, channel.id)];
}

const StickerSpoiler = ErrorBoundary.wrap(({ stickers }: { stickers: ReactNode; }) => (
    <Spoiler type="attachment" inline={false}>{() => stickers}</Spoiler>
), { noop: true });

const EmbedsSpoiler = ErrorBoundary.wrap(({ embeds }: { embeds: ReactNode; }) => (
    <Spoiler type="embed" inline={false}>{() => embeds}</Spoiler>
), { noop: true });

const retryWatchers = proxyLazy(() => lodash.throttle(() => {
    pipewire?.retryNow();
    obs?.retryNow();
}, 5000));

function onStoreChange() {
    refreshConceal();
    retryWatchers();
}

function onPipewireState(streaming: boolean) {
    isPipewireStreaming = streaming;
    refreshConceal();
}

function onObsState(active: boolean) {
    isObsStreaming = active;
    refreshConceal();
}

function startPipewire() {
    pipewire = startPipewireWatcher(() => settings.store.pipewireWatcherUrl, onPipewireState);
}

function startObs() {
    obs = startObsWatcher({
        getAddress: () => settings.store.obsAddress,
        getPassword: () => settings.store.obsPassword,
        includeRecording: () => settings.store.obsIncludeRecording,
        includeVirtualCam: () => settings.store.obsIncludeVirtualCam,
    }, onObsState);
}

function updateWatchers() {
    if (settings.store.detectPipewireWatcher) {
        if (!pipewire) startPipewire();
    } else {
        pipewire?.stop();
        pipewire = null;
    }

    if (settings.store.detectObs) {
        if (!obs) startObs();
    } else {
        obs?.stop();
        obs = null;
    }

    refreshConceal();
}

const restartPipewire = proxyLazy(() => lodash.debounce(() => {
    if (!pipewire) return;
    pipewire.stop();
    startPipewire();
}, 1000));

const restartObs = proxyLazy(() => lodash.debounce(() => {
    if (!obs) return;
    obs.stop();
    startObs();
}, 1000));

function onSettingChange(key: SettingKey) {
    switch (key) {
        case "pipewireWatcherUrl":
            restartPipewire();
            break;
        case "obsAddress":
        case "obsPassword":
            restartObs();
            break;
        case "obsIncludeRecording":
        case "obsIncludeVirtualCam":
            obs?.refresh?.();
            break;
        case "detectPipewireWatcher":
        case "detectObs":
            updateWatchers();
            break;
        case "conceal":
        case "includeGroupDms":
            invalidate();
            break;
        default:
            refreshConceal();
    }
}

function onWindowFocus() {
    retryWatchers();
}

export default definePlugin({
    name: pluginInfo.name,
    description: pluginInfo.description,
    authors: pluginInfo.authors,
    settings,

    start() {
        StreamerModeStore.addChangeListener(onStoreChange);
        ApplicationStreamingStore.addChangeListener(onStoreChange);
        window.addEventListener("focus", onWindowFocus);
        registerSettingsCallback(onSettingChange);
        updateWatchers();
    },

    stop() {
        StreamerModeStore.removeChangeListener(onStoreChange);
        ApplicationStreamingStore.removeChangeListener(onStoreChange);
        window.removeEventListener("focus", onWindowFocus);
        registerSettingsCallback(null);
        retryWatchers.cancel();
        restartPipewire.cancel();
        restartObs.cancel();
        pipewire?.stop();
        pipewire = null;
        obs?.stop();
        obs = null;

        isPipewireStreaming = isObsStreaming = wasStreaming = false;
        if (settings.store.streamerModeEnabledByPlugin) {
            settings.store.streamerModeEnabledByPlugin = false;
            if (StreamerModeStore.enabled) setStreamerMode(false);
        }
        if (concealActive) {
            concealActive = false;
            invalidate();
        }
    },

    patches: [{
        find: PATTERNS.webpack.accessoriesFind,
        replacement: [
            {
                match: PATTERNS.webpack.renderAttachments,
                replace: "$1=$self.withSpoilerAttachments($1,this.props.channel);"
            },
            {
                match: PATTERNS.webpack.stickersCall,
                replace: "$self.wrapStickers($&,$1,this.props.channel)"
            },
            {
                match: PATTERNS.webpack.embedsCall,
                replace: "$self.wrapEmbeds($&,$1,this.props.channel)"
            }
        ]
    }, {
        find: PATTERNS.webpack.contentFind,
        replacement: {
            match: PATTERNS.webpack.content,
            replace: "$1=$self.spoilerContent($1,arguments[1]);"
        }
    }, {
        find: PATTERNS.webpack.embedFind,
        replacement: {
            match: PATTERNS.webpack.embedSpoiler,
            replace: "($1||$self.shouldSpoilerEmbed(arguments[0],arguments[1]))"
        }
    }],

    wrapStickers(stickers: ReactNode, message: Message, channel: Channel) {
        if (stickers == null || !settings.store.conceal.stickers || !message.stickerItems.length || !concealsIn(channel)) return stickers;
        return <StickerSpoiler stickers={stickers} />;
    },

    wrapEmbeds(embeds: ReactNode, message: Message, channel: Channel) {
        if (embeds == null || !concealsWholeEmbeds(message, channel)) return embeds;
        return <EmbedsSpoiler embeds={embeds} />;
    },

    withSpoilerAttachments,
    shouldSpoilerEmbed,
    spoilerContent,
});
