import * as asar from '@electron/asar';

// Read the vendor's actual entry-point styles, including builds with hashed names.
export function codexStylesheets(archive) {
    const files = new Set(), scripts = new Set();
    for (const entry of ['webview/index.html', 'webview/detached-window.html']) {
        const html = asar.extractFile(archive, entry).toString();
        for (const script of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
            const url = new URL(script[1], `https://fixture.invalid/${entry}`);
            const name = url.pathname.startsWith('/assets/') ? '/webview' + url.pathname : url.pathname;
            if (url.origin === 'https://fixture.invalid' && /^\/webview\/assets\/[^/]+\.js$/.test(name)) scripts.add(name);
        }
        for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
            if (!/\brel=["']stylesheet["']/i.test(link[0])) continue;
            const href = link[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
            if (!href) continue;
            const url = new URL(href, `https://fixture.invalid/${entry}`);
            if (url.origin === 'https://fixture.invalid' && /^\/webview\/assets\/[^/]+\.css$/.test(url.pathname)) {
                asar.statFile(archive, url.pathname.slice(1));
                files.add(url.pathname);
            }
        }
    }
    // Rspack builds request their initial CSS through the entry runtime rather than link tags.
    // Read literal startup chunk IDs and the CSS map; never execute vendor JavaScript.
    if (!files.size) for (const script of scripts) {
        const source = asar.extractFile(archive, script.slice(1)).toString(), start = source.indexOf('.miniCssF=');
        if (start < 0) continue;
        const mapping = source.slice(start).match(/^[\s\S]*?\.css["']/)?.[0] || '';
        const hashes = new Map([...mapping.matchAll(/(\d+):["']([a-f0-9]+)["']/g)].map(match => [match[1], match[2]]));
        for (const request of source.matchAll(/\b\w+\.e\((\d+)\)/g)) {
            const hash = hashes.get(request[1]); if (!hash) continue;
            const file = `/webview/assets/async/${hash}.css`; asar.statFile(archive, file.slice(1)); files.add(file);
        }
    }
    return [...files];
}
