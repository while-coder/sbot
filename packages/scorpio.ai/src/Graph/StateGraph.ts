export const START = "__start__";
export const END = "__end__";

export class StateGraph<S extends Record<string, any>> {
    private readonly nodes = new Map<string, (state: S) => Promise<Partial<S>> | Partial<S>>();
    private readonly edges = new Map<string, string>();
    private readonly conditionalEdges = new Map<string, (state: S) => string>();

    addNode(name: string, fn: (state: S) => Promise<Partial<S>> | Partial<S>): this {
        this.nodes.set(name, fn);
        return this;
    }

    addEdge(source: string, target: string): this {
        this.edges.set(source, target);
        return this;
    }

    addConditionalEdges(source: string, routingFn: (state: S) => string): this {
        this.conditionalEdges.set(source, routingFn);
        return this;
    }

    stream(initialState: S) {
        const { nodes, edges, conditionalEdges } = this;

        async function* run() {
            const state = { ...initialState } as S;

            let currentNode: string | null = edges.get(START) ?? null;
            if (!currentNode) throw new Error("No edge defined from START");

            while (currentNode && currentNode !== END) {
                const nodeFn = nodes.get(currentNode);
                if (!nodeFn) throw new Error(`Node "${currentNode}" not found`);

                const update = (await nodeFn(state)) ?? {};

                // Arrays are appended, everything else is replaced
                for (const [key, value] of Object.entries(update)) {
                    (state as any)[key] = Array.isArray((state as any)[key]) && Array.isArray(value)
                        ? [...(state as any)[key], ...value]
                        : value;
                }

                yield { [currentNode]: update };

                const conditionalFn = conditionalEdges.get(currentNode);
                currentNode = conditionalFn ? conditionalFn(state) : (edges.get(currentNode) ?? null);
            }
        }

        return run();
    }
}
