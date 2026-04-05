import type { Server } from 'node:http';
export declare function makeTempDir(prefix?: string): Promise<string>;
export declare function removeTempDir(path: string): Promise<void>;
export declare function withTempDir<T>(fn: (path: string) => Promise<T>, prefix?: string): Promise<T>;
export declare function listen(server: Server): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
}>;
export declare function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<{
    status: number;
    body: any;
}>;
export declare function runCliJson(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<any>;
export declare function writeJsonFile(path: string, value: unknown): Promise<void>;
export declare function readText(path: string): Promise<string>;
//# sourceMappingURL=core-test-helpers.d.ts.map