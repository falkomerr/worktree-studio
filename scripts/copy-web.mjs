import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "src", "web");
const target = join(root, "dist", "web");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
