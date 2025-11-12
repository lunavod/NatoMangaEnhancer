import { db } from "./database";

const symbolReplacements = {
    '’': "'"
}

type Sanitizer = (description: string, title: string) => [string, boolean];
const sanitizers: Sanitizer[] = [
    (description: string): [string, boolean] => {
        const regexp = /You are reading .+, one of the most popular .+ covering in .+ genres, written by.+a top manga site to offering for free\. .+ has \d* translated chapters and translations of other chapters are in progress. Lets enjoy. If you want to get the updates about latest chapters, lets create an account and add .+ to your bookmark. (.+)/;
        const match = description.match(regexp);
        if (match && match[1]) {
            return [match[1], true];
        }
        return [description, false];
    },
    (description: string): [string, boolean] => {
        const regexp = /You are reading .+, one of the most popular .+ covering in .+ genres, written by.+a top manga site to offering for free\. .+ has \d* translated chapters and translations of other chapters are in progress. Lets enjoy. If you want to get the updates about latest chapters, lets create an account and add .+ to your bookmark\.\s*$/;
        const match = description.match(regexp);
        if (match) {
            return ['', true];
        }
        return [description, false];
    },
    (description: string): [string, boolean] => {
        const regexp = /.+? summary is updating\. Come visit mangabuddy\.com sometime to read the latest chapter of .+?\. If you have any question about this manga, Please don't hesitate to contact us or translate team\. Hope you enjoy it\.(.*)/;
        const match = description.match(regexp);
        if (match) {
            return [match[1] ?? '', true];
        }
        return [description, false];
    },
    (description: string, title: string): [string, boolean] => {
        const regexp = /Read .+ \/ (.*)/;
        const match = description.match(regexp);
        if (match) {
            return [match[1] ?? '', true];
        }
        return [description, false];
    },
    (description) => {
        let changed = false;
        Object.entries(symbolReplacements).forEach(([symbol, replacement]) => {
            if (!description.includes(symbol)) {
                console.log("[sanitizer] Symbol not found, skipping:", symbol);
                return;
            }

            description = description.replaceAll(symbol, replacement);
            changed = true;
        })
        return [description, changed];
    },
]

export function sanitizeDescription(description: string, title: string): string {

    for (let i = 0; i < 10; i++) {
        // Limit the number of iterations to prevent infinite loops
        console.warn("[sanitizer] Iteration:", i)
        let changed = false;
        for (const sanitizer of sanitizers) {
            const [newDescription, wasChanged] = sanitizer(description, title);
            if (wasChanged) {
                console.log("[sanitizer] Description changed:", description, "->", newDescription);
                description = newDescription.trim();

                if (!description) {
                    description = 'No description available';
                }
                changed = true;
                break; // Restart the loop to apply all sanitizers again
            }
        }
        if (!changed) {
            break; // No more changes, exit the loop
        }
    }

    return description.trim();
}

export type Manga = {
    cover: string;
    id: string;
    title: string;
    description: string;
}

export function getMangaIdFromUrl(url: string): string {
    const match = url.match(/\/manga\/([^/]+)/);
    if (!match) {
        throw new Error(`Invalid manga URL: ${url}`);
    }
    return match[1];
}

export async function getMangaById(id: string): Promise<Manga> {
    const url = `https://www.natomanga.com/manga/${id}`;
    const result = await db.mangas.get(id);
    if (result) {
        console.log("Manga found in cache:", result);
        return result;
    }

    const manga = await fetchManga(url);
    console.log("Refetched manga:", manga);
    const record = {
        id: manga.id,
        cover: manga.cover,
        title: manga.title,
        description: manga.description,
        cachedAt: new Date()
    }
    await db.mangas.put(record);
        console.log("Manga cached:", record);

    return manga;
}

export async function getMangaFromUrl(url: string): Promise<Manga> {
    const id = getMangaIdFromUrl(url);
    return getMangaById(id);
}

export async function fetchManga(url: string): Promise<Manga> {
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Failed to fetch manga from ${url}: ${resp.statusText}`);
    }
    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    const title = doc.querySelector(".manga-info-text li h1")?.textContent?.trim() || "";
    if (!title) {
        throw new Error("Manga title not found");
    }
    
    const cover = doc.querySelector(".manga-info-pic img")?.getAttribute("src") || "";
    if (!cover) {
        throw new Error("Manga cover not found");
    }

    const descriptionElement = doc.querySelector("#contentBox")
    if (!descriptionElement) {
        throw new Error("Description element not found on the manga page.");
    }
    const textNode = descriptionElement.lastChild;
    const description = sanitizeDescription(textNode!.textContent?.replaceAll("  ", "").replaceAll("\n", " ") ?? "", title);

    return {
        cover,
        title,
        id: getMangaIdFromUrl(url),
        description
    }
}