export const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
export const MAX_FONT_LABEL_LENGTH = MAX_NAME_LENGTH * 2 + 1;

const unicode = new TextDecoder('utf-16be');
const macintosh = new TextDecoder('macintosh');

/** Read the SFNT name table after checking all table and string bounds. */
export function inspectFont(bytes) {
    const font = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES || ![0x00010000, 0x4f54544f].includes(font.getUint32(0)))
        throw new Error('Choose a valid TTF or OTF font (up to 2 MB).');
    const count = font.getUint16(4);
    if (!count || 12 + count * 16 > bytes.length) throw new Error('The font table is incomplete.');
    let names;
    for (let i = 0; i < count; i++) {
        const entry = 12 + i * 16, start = font.getUint32(entry + 8), length = font.getUint32(entry + 12);
        if (start > bytes.length || length > bytes.length - start) throw new Error('The font table is incomplete.');
        if (font.getUint32(entry) === 0x6e616d65) names = new DataView(bytes.buffer, bytes.byteOffset + start, length);
    }
    if (!names || names.byteLength < 6) throw new Error('The font has no readable family name.');
    const records = names.getUint16(2), strings = names.getUint16(4), candidates = [];
    if (6 + records * 12 > names.byteLength || strings < 6 + records * 12 || strings > names.byteLength) throw new Error('The font names are incomplete.');
    for (let i = 0; i < records; i++) {
        const entry = 6 + i * 12, platform = names.getUint16(entry), language = names.getUint16(entry + 4);
        const encoding = names.getUint16(entry + 2), name = names.getUint16(entry + 6), length = names.getUint16(entry + 8), offset = strings + names.getUint16(entry + 10);
        if (offset > names.byteLength || length > names.byteLength - offset) throw new Error('The font names are incomplete.');
        const roman = platform === 1 && encoding === 0;
        if (![1, 2, 4, 16, 17].includes(name) || (!roman && (![0, 3].includes(platform) || length % 2))) continue;
        const raw = new Uint8Array(names.buffer, names.byteOffset + offset, length);
        const label = (roman ? macintosh : unicode).decode(raw).trim().normalize('NFC');
        const limit = name === 4 ? MAX_FONT_LABEL_LENGTH : MAX_NAME_LENGTH;
        if (label && label.length <= limit && !/[\u0000-\u001f\u007f-\u009f\ufffd]/.test(label)) {
            const rank = language === 0x409 ? 0 : roman ? (language === 0 ? 1 : 3) : 2;
            candidates.push({ name, label, rank });
        }
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const named = id => candidates.find(entry => entry.name === id)?.label;
    const family = named(16) || named(1);
    if (!family) throw new Error('The font has no readable family name.');
    const fullName = named(4);
    const style = named(17) || named(2);
    const base = fullName || family;
    // Some faces omit the style from the full name, including regular faces.
    const label = base === family && style && !family.toLowerCase().endsWith(' ' + style.toLowerCase())
        ? `${family} ${style}` : base;
    return { label, ext: font.getUint32(0) === 0x4f54544f ? '.otf' : '.ttf' };
}
