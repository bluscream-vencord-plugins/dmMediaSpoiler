/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createBackoff } from "./backoff";

/** How often /status is polled while the event stream is down and the helper does answer. */
const POLL_INTERVAL = 3000;

export function startPipewireWatcher(
    getUrl: () => string,
    onStateChange: (streaming: boolean) => void
): () => void {
    let active = true;
    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let sseTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStreaming: boolean | null = null;
    // Retries double while the helper isn't reachable, and start over once it answers.
    const sseBackoff = createBackoff();
    const pollBackoff = createBackoff(POLL_INTERVAL);

    const baseUrl = () => (getUrl() || "http://127.0.0.1:28282").replace(/\/+$/, "");

    function emit(streaming: boolean) {
        if (streaming !== lastStreaming) {
            lastStreaming = streaming;
            onStateChange(streaming);
        }
    }

    /** Polls /status while the event stream is down; only one poll loop runs at a time. */
    function startPolling() {
        if (active && !eventSource && pollTimer == null) pollStatus();
    }

    async function pollStatus() {
        pollTimer = null;
        if (!active || eventSource) return;
        let reachable = false;
        try {
            const res = await fetch(`${baseUrl()}/status`, { cache: "no-store" });
            reachable = true;
            emit(res.ok && Boolean((await res.json()).streaming));
        } catch {
            emit(false);
        }
        if (reachable) pollBackoff.reset();
        if (active && !eventSource) pollTimer = setTimeout(pollStatus, pollBackoff.next());
    }

    function connectSSE() {
        sseTimer = null;
        if (!active) return;
        try {
            eventSource = new EventSource(`${baseUrl()}/events`);
        } catch {
            eventSource = null;
            startPolling();
            return;
        }

        eventSource.onopen = () => {
            sseBackoff.reset();
            pollBackoff.reset();
            if (pollTimer != null) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
        };

        eventSource.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if (data && typeof data.streaming === "boolean") {
                    emit(data.streaming);
                }
            } catch {
                // Ignore keepalive or malformed data
            }
        };

        eventSource.onerror = () => {
            eventSource?.close();
            eventSource = null;
            emit(false);
            startPolling();
            if (active && sseTimer == null) sseTimer = setTimeout(connectSSE, sseBackoff.next());
        };
    }

    connectSSE();

    return () => {
        active = false;
        eventSource?.close();
        eventSource = null;
        if (pollTimer != null) clearTimeout(pollTimer);
        if (sseTimer != null) clearTimeout(sseTimer);
        pollTimer = null;
        sseTimer = null;
        emit(false);
    };
}
