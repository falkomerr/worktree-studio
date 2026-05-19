import net from "node:net";

export async function findFreePort(host: string, range: [number, number]): Promise<number> {
    for (let port = range[0]; port <= range[1]; port++) {
        if (await isPortFree(host, port)) return port;
    }
    throw new Error(`No free port in ${range[0]}-${range[1]}`);
}

export function isPortFree(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port, host);
    });
}
