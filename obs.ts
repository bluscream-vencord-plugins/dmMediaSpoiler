/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createBackoff } from "./backoff";

export interface ObsWatcherOptions {
    getAddress: () => string;
    getPassword: () => string;
    includeRecording: () => boolean;
    includeVirtualCam: () => boolean;
}

async function computeObsAuth(password: string, salt: string, challenge: string): Promise<string> {
    const encoder = new TextEncoder();
    const passSaltHash = await crypto.subtle.digest("SHA-256", encoder.encode(password + salt));
    const secretHashBase64 = btoa(String.fromCharCode(...new Uint8Array(passSaltHash)));
    const authHash = await crypto.subtle.digest("SHA-256", encoder.encode(secretHashBase64 + challenge));
    return btoa(String.fromCharCode(...new Uint8Array(authHash)));
}

export function startObsWatcher(
    options: ObsWatcherOptions,
    onStateChange: (active: boolean) => void
): () => void {
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const backoff = createBackoff();

    let isStreaming = false;
    let isRecording = false;
    let isVirtualCam = false;
    let lastActive: boolean | null = null;

    function evaluateActive() {
        const currentlyActive = isStreaming
            || (options.includeRecording() && isRecording)
            || (options.includeVirtualCam() && isVirtualCam);

        if (currentlyActive !== lastActive) {
            lastActive = currentlyActive;
            onStateChange(currentlyActive);
        }
    }

    function resetState() {
        isStreaming = false;
        isRecording = false;
        isVirtualCam = false;
        evaluateActive();
    }

    function scheduleReconnect() {
        if (!active || reconnectTimer != null) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, backoff.next());
    }

    function sendOp(op: number, d: Record<string, unknown>) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op, d }));
        }
    }

    function connect() {
        if (!active) return;
        resetState();

        const address = options.getAddress().trim() || "ws://127.0.0.1:4455";
        try {
            ws = new WebSocket(address);
        } catch {
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            // Wait for Op 0 (Hello) from server
        };

        ws.onmessage = async event => {
            try {
                const message = JSON.parse(event.data as string);
                const { op, d } = message;

                if (op === 0) {
                    // Op 0: Hello
                    let authResponse: string | undefined;
                    if (d?.authentication) {
                        const pass = options.getPassword();
                        if (pass) {
                            authResponse = await computeObsAuth(pass, d.authentication.salt, d.authentication.challenge);
                        }
                    }

                    // Op 1: Identify
                    // Event subscription 33 = General (1) + Outputs (32)
                    sendOp(1, {
                        rpcVersion: 1,
                        authentication: authResponse,
                        eventSubscriptions: 33,
                    });
                } else if (op === 2) {
                    // Op 2: Identified, so the connection works: start the next reconnect from the shortest delay again.
                    backoff.reset();
                    // Query current output states
                    sendOp(6, { requestType: "GetStreamStatus", requestId: "dmms-stream" });
                    sendOp(6, { requestType: "GetRecordStatus", requestId: "dmms-record" });
                    sendOp(6, { requestType: "GetVirtualCamStatus", requestId: "dmms-vcam" });
                } else if (op === 7) {
                    // Op 7: RequestResponse
                    if (d?.requestId === "dmms-stream" && d?.responseData) {
                        isStreaming = Boolean(d.responseData.outputActive);
                        evaluateActive();
                    } else if (d?.requestId === "dmms-record" && d?.responseData) {
                        isRecording = Boolean(d.responseData.outputActive);
                        evaluateActive();
                    } else if (d?.requestId === "dmms-vcam" && d?.responseData) {
                        isVirtualCam = Boolean(d.responseData.outputActive);
                        evaluateActive();
                    }
                } else if (op === 5) {
                    // Op 5: Event
                    if (d?.eventType === "StreamStateChanged" && d?.eventData) {
                        isStreaming = Boolean(d.eventData.outputActive);
                        evaluateActive();
                    } else if (d?.eventType === "RecordStateChanged" && d?.eventData) {
                        isRecording = Boolean(d.eventData.outputActive);
                        evaluateActive();
                    } else if (d?.eventType === "VirtualcamStateChanged" && d?.eventData) {
                        isVirtualCam = Boolean(d.eventData.outputActive);
                        evaluateActive();
                    }
                }
            } catch {
                // Ignore parsing errors
            }
        };

        ws.onclose = () => {
            ws = null;
            resetState();
            scheduleReconnect();
        };

        ws.onerror = () => {
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // Ignore
                }
                ws = null;
            }
            resetState();
            scheduleReconnect();
        };
    }

    connect();

    return () => {
        active = false;
        if (reconnectTimer != null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (ws) {
            try {
                ws.close();
            } catch {
                // Ignore
            }
            ws = null;
        }
        resetState();
    };
}
