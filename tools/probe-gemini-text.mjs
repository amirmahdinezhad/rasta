import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localSigningEntitlements } from '../bin/lib/codex-native.js';
import { addNativeLoader, inspectNativeLoader } from '../bin/lib/macho-loader.js';

// Run Core Text in a disposable executable. The installed Gemini app is never executed or changed.
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-text-'));
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
try {
    const library = path.join(folder, 'Rasta.dylib');
    run('/usr/bin/xcrun', ['clang', '-dynamiclib', '-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'CoreText',
        path.join(root, 'native/GeminiTextProbe.m'), '-o', library]);
    const fixture = path.join(folder, 'fixture.m');
    fs.writeFileSync(fixture, String.raw`
#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <dlfcn.h>
typedef BOOL (*Configure)(const char *, CGFloat, BOOL);
typedef NSDictionary *(*Status)(void);
static NSDictionary *describeLine(CTLineRef line) {
    CFArrayRef runs = CTLineGetGlyphRuns(line);
    CFDictionaryRef attributes = CTRunGetAttributes(CFArrayGetValueAtIndex(runs, 0));
    CTFontRef font = CFDictionaryGetValue(attributes, kCTFontAttributeName);
    NSString *family = CFBridgingRelease(CTFontCopyFamilyName(font));
    id paragraph = (__bridge id)CFDictionaryGetValue(attributes, kCTParagraphStyleAttributeName);
    BOOL rtl = NO; CGFloat indent = 0;
    if ([paragraph isKindOfClass:NSParagraphStyle.class]) { rtl = [paragraph baseWritingDirection] == NSWritingDirectionRightToLeft; indent = [paragraph headIndent]; }
    else if (paragraph) { CTWritingDirection direction; CTParagraphStyleGetValueForSpecifier((__bridge CTParagraphStyleRef)paragraph, kCTParagraphStyleSpecifierBaseWritingDirection, sizeof(direction), &direction); rtl = direction == kCTWritingDirectionRightToLeft; CTParagraphStyleGetValueForSpecifier((__bridge CTParagraphStyleRef)paragraph, kCTParagraphStyleSpecifierHeadIndent, sizeof(indent), &indent); }
    NSDictionary *result = @{@"font": family, @"size": @(CTFontGetSize(font)), @"rtl": @(rtl), @"indent": @(indent)};
    CFRelease(line);
    return result;
}
static NSDictionary *describe(NSAttributedString *text) {
    return describeLine(CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)text));
}
static NSDictionary *describeFrame(NSAttributedString *text) {
    CTFramesetterRef setter = CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)text);
    CGPathRef path = CGPathCreateWithRect(CGRectMake(0, 0, 500, 300), NULL);
    CTFrameRef frame = CTFramesetterCreateFrame(setter, CFRangeMake(0, 0), path, NULL);
    CFArrayRef lines = CTFrameGetLines(frame);
    NSDictionary *result = describeLine((CTLineRef)CFRetain(CFArrayGetValueAtIndex(lines, 0)));
    CFRelease(frame); CFRelease(path); CFRelease(setter);
    return result;
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        Configure configure = (Configure)dlsym(RTLD_DEFAULT, "RastaConfigureTextProbe");
        if (!configure || !configure(argv[1], 18, YES)) return 2;
        NSString *sample = [NSString stringWithFormat:@"%C%C%C%C", 0x633, 0x644, 0x627, 0x645];
        NSFont *body = [NSFont systemFontOfSize:14];
        NSFont *code = [NSFont monospacedSystemFontOfSize:14 weight:NSFontWeightRegular];
        NSAttributedString *persian = [[NSAttributedString alloc] initWithString:sample attributes:@{NSFontAttributeName: body}];
        NSAttributedString *latin = [[NSAttributedString alloc] initWithString:@"English body" attributes:@{NSFontAttributeName: body}];
        NSAttributedString *sourceCode = [[NSAttributedString alloc] initWithString:sample attributes:@{NSFontAttributeName: code}];
        NSDictionary *active = describe(persian);
        NSDictionary *framesetter = describeFrame(persian);
        CGFloat indent = 8;
        CTParagraphStyleSetting setting = { kCTParagraphStyleSpecifierHeadIndent, sizeof(indent), &indent };
        CTParagraphStyleRef style = CTParagraphStyleCreate(&setting, 1);
        NSAttributedString *ctText = [[NSAttributedString alloc] initWithString:sample attributes:@{NSFontAttributeName: body, (__bridge id)kCTParagraphStyleAttributeName: (__bridge id)style}];
        NSDictionary *coreTextStyle = describe(ctText); CFRelease(style);
        NSDictionary *unchangedLatin = describe(latin);
        NSDictionary *unchangedCode = describe(sourceCode);
        if (!configure(argv[1], 18, NO)) return 3;
        NSDictionary *inactive = describe(persian);
        Status status = (Status)dlsym(RTLD_DEFAULT, "RastaTextProbeStatus");
        NSDictionary *result = @{@"active": active, @"framesetter": framesetter, @"coreTextStyle": coreTextStyle, @"latin": unchangedLatin, @"code": unchangedCode, @"inactive": inactive, @"probe": status(),
            @"sourceSize": @([(NSFont *)[persian attribute:NSFontAttributeName atIndex:0 effectiveRange:NULL] pointSize]),
            @"sourcePreserved": @((BOOL)([persian.string isEqualToString:sample] && [[persian attributesAtIndex:0 effectiveRange:NULL] isEqual:@{NSFontAttributeName: body}]))};
        NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
        puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    }
}
`);
    const executable = path.join(folder, 'fixture');
    run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O0', '-framework', 'AppKit', '-framework', 'CoreText', fixture, '-o', executable]);
    const result = JSON.parse(run(executable, [path.join(root, 'bin/assets/Vazir-Regular.ttf')], {
        env: { ...process.env, DYLD_INSERT_LIBRARIES: library },
    }));
    assert.match(result.active.font, /Vazir/);
    assert.equal(result.active.size, 18);
    assert.equal(result.active.rtl, true);
    assert.match(result.framesetter.font, /Vazir/);
    assert.equal(result.framesetter.size, 18);
    assert.equal(result.framesetter.rtl, true);
    assert.match(result.coreTextStyle.font, /Vazir/);
    assert.equal(result.coreTextStyle.rtl, true);
    assert.equal(result.coreTextStyle.indent, 8);
    assert.equal(result.latin.size, 14);
    assert.equal(result.latin.rtl, false);
    assert.equal(result.code.size, 14);
    assert.equal(result.code.rtl, false);
    assert.equal(result.inactive.size, 14);
    assert.equal(result.inactive.rtl, false);
    assert.equal(result.sourceSize, 14);
    assert.equal(result.sourcePreserved, true);
    const bytes = fs.readFileSync(executable), patched = addNativeLoader(bytes);
    assert.equal(inspectNativeLoader(patched).codeHash, inspectNativeLoader(bytes).codeHash);
    assert.throws(() => addNativeLoader(patched), /already contains/);
    fs.writeFileSync(executable, patched);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', library]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', executable]);
    run('/usr/bin/codesign', ['--verify', '--strict', executable]);
    let strictResult, restricted;
    try { strictResult = JSON.parse(run(executable, [path.join(root, 'bin/assets/Vazir-Regular.ttf')])); }
    catch (error) { restricted = error; }
    // macOS releases differ in their treatment of two ad-hoc signed images.
    // Observe that policy; neither result replaces verification of the final signature.
    if (restricted) assert.match(restricted.stderr || '', /different Team IDs|code signature|library validation/i);
    else { assert.match(strictResult.active.font, /Vazir/); assert.equal(strictResult.active.rtl, true); }
    const entitlements = path.join(folder, 'fixture-entitlements.plist');
    fs.writeFileSync(entitlements, JSON.stringify(localSigningEntitlements({})));
    run('/usr/bin/plutil', ['-convert', 'xml1', entitlements]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, executable]);
    run('/usr/bin/codesign', ['--verify', '--strict', executable]);
    const signedPermissions = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', executable]);
    const permissions = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: signedPermissions }));
    assert.equal(permissions['com.apple.security.cs.disable-library-validation'], true);
    const nativeResult = JSON.parse(run(executable, [path.join(root, 'bin/assets/Vazir-Regular.ttf')]));
    assert.match(nativeResult.active.font, /Vazir/);
    assert.equal(nativeResult.active.rtl, true);
    assert.equal(nativeResult.framesetter.rtl, true);
    assert.equal(nativeResult.code.rtl, false);
    assert.equal(nativeResult.sourcePreserved, true);
    console.log(JSON.stringify({ scope: 'isolated-core-text-probe', ...result }, null, 2));
    console.log(JSON.stringify({ hardenedAdHocLoading: restricted ? 'rejected' : 'permitted', localPolicySignatureVerified: true }));
} finally {
    fs.rmSync(folder, { recursive: true, force: true });
}
