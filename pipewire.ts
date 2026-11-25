/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { createBackoff, DISCONNECT_GRACE_MS, Watcher } from "./backoff";
import { PATTERNS } from "./patterns";

const logger = new Logger("DmMediaSpoiler");
const POLL_INTERVAL = 3000;

function readStreaming(data: unknown): boolean | null {
    return typeof data === "object" && data !== null && "streaming" in data && typeof data.streaming === "boolean" ? data.streaming : null;
}

export function startPipewireWatcher(getUrl: () => string, onStateChange: (streaming: boolean) => void): Watcher {
    let running = true;
    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let sseTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let fetchAbort: AbortController | null = null;
    let lastStreaming: boolean | null = null;
    const sseBackoff = createBackoff();
    const pollBackoff = createBackoff(POLL_INTERVAL);

    const baseUrl = () => (getUrl().trim() || PATTERNS.pipewire.defaultUrl).replace(PATTERNS.pipewire.trailingSlashes, "");

    function clearGrace() {
        if (graceTimer != null) clearTimeout(graceTimer);
        graceTimer = null;
    }

    function emit(streaming: boolean) {
        clearGrace();
        if (streaming === lastStreaming) return;
        lastStreaming = streaming;
        onStateChange(streaming);
    }

    function lost() {
        if (!lastStreaming) emit(false);
        else if (graceTimer == null) graceTimer = setTimeout(() => {
            graceTimer = null;
            emit(false);
        }, DISCONNECT_GRACE_MS);
    }

    async function fetchStatus(): Promise<boolean | null> {
        fetchAbort?.abort();
        const abort = fetchAbort = new AbortController();
        try {
            const res = await fetch(baseUrl() + PATTERNS.pipewire.statusPath, { cache: "no-store", signal: abort.signal });
            if (!res.ok) return false;
            return readStreaming(await res.json()) ?? false;
        } catch (err) {
            if (!abort.signal.aborted) logger.debug("PipeWire helper not reachable", err);
            return null;
        } finally {
            if (fetchAbort === abort) fetchAbort = null;
        }
    }

    function startPolling() {
        if (running && !eventSource && pollTimer == null && !polling) pollStatus();
    }

    async function pollStatus() {
        pollTimer = null;
        polling = true;
        try {
            const streaming = await fetchStatus();
            if (!running || eventSource) return;
            if (streaming === null) lost();
            else {
                pollBackoff.reset();
                emit(streaming);
            }
        } finally {
            polling = false;
            if (running && !eventSource) pollTimer = setTimeout(pollStatus, pollBackoff.next());
        }
    }

    function stopPolling() {
        if (pollTimer != null) clearTimeout(pollTimer);
        pollTimer = null;
        fetchAbort?.abort();
    }

    function connectSSE() {
        sseTimer = null;
        if (!running) return;
        let source: EventSource;
        try {
            source = new EventSource(baseUrl() + PATTERNS.pipewire.eventsPath);
        } catch (err) {
            logger.warn("Can't connect to the PipeWire helper", err);
            startPolling();
            sseTimer = setTimeout(connectSSE, sseBackoff.next());
            return;
        }
        eventSource = source;

        source.onopen = async () => {
            if (eventSource !== source) return;
            sseBackoff.reset();
            pollBackoff.reset();
            stopPolling();
            const streaming = await fetchStatus();
            if (eventSource === source && streaming !== null) emit(streaming);
        };

        source.onmessage = event => {
            if (eventSource !== source || typeof event.data !== "string") return;
            try {
                const streaming = readStreaming(JSON.parse(event.data));
                if (streaming !== null) emit(streaming);
            } catch (err) {
                logger.debug("Ignoring a malformed PipeWire event", err);
            }
        };

        source.onerror = () => {
            if (eventSource !== source) return;
            source.close();
            eventSource = null;
            lost();
            startPolling();
            if (running && sseTimer == null) sseTimer = setTimeout(connectSSE, sseBackoff.next());
        };
    }

    connectSSE();

    return {
        stop() {
            running = false;
            eventSource?.close();
            eventSource = null;
            stopPolling();
            if (sseTimer != null) clearTimeout(sseTimer);
            sseTimer = null;
            emit(false);
        },
        retryNow() {
            if (!running || eventSource) return;
            if (sseTimer != null) {
                clearTimeout(sseTimer);
                connectSSE();
            }
        }
    };
}
