export function stripJsonComments(input: string): string {
    let output = "";
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let index = 0; index < input.length; index++) {
        const char = input[index];
        const next = input[index + 1];
        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }
        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
            output += char;
            continue;
        }
        if (char === "/" && next === "/") {
            while (index < input.length && input[index] !== "\n") index++;
            output += "\n";
            continue;
        }
        if (char === "/" && next === "*") {
            index += 2;
            while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index++;
            index++;
            continue;
        }
        output += char;
    }
    return output;
}

export function parseJsonObject(input: string, pathForError: string): Record<string, unknown> {
    const parsed = JSON.parse(stripJsonComments(input)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${pathForError} must contain a JSON object`);
    }
    return parsed as Record<string, unknown>;
}
