import type { MessageContent } from "scorpio.saver";

export interface SteeringInput {
    prepare(): Promise<MessageContent> | MessageContent;
    onPersisted?(content: MessageContent): Promise<void> | void;
    onRejected?(): void;
}

/** Accepted input belongs to the active turn until it closes at a model/tool boundary. */
export class TurnSteering {
    private readonly pending: SteeringInput[] = [];
    private closed = false;
    private interruptibleStep?: AbortController;

    get hasPending(): boolean { return this.pending.length > 0; }

    offer(input: SteeringInput): boolean {
        if (this.closed) return false;
        this.pending.push(input);
        this.interruptibleStep?.abort();
        return true;
    }

    shift(): SteeringInput | undefined {
        return this.pending.shift();
    }

    watchInterruptibleStep(controller: AbortController): () => void {
        this.interruptibleStep = controller;
        if (this.hasPending) controller.abort();
        return () => { this.interruptibleStep = undefined; };
    }

    close(): void {
        this.closed = true;
        for (const input of this.pending.splice(0)) input.onRejected?.();
    }
}
