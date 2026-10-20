// Computer-sound capture for the macOS recorder (spec §15), the counterpart of recorder/win_loopback.py.
//
//   homacapture-sysaudio <out.wav>
//
// Captures everything the Mac plays (ScreenCaptureKit audio, macOS 13+, under the Screen Recording permission of the
// app that launched it) as a 48 kHz stereo float32 WAV. Sync: every sample buffer carries a host-clock presentation
// time, which is CLOCK_UPTIME_RAW, the clock narrate.py stamps everything else with. The first buffer's time is
// printed as t0; gaps (ScreenCaptureKit can skip buffers while nothing plays) are filled with zeros, so sample N is
// always at t0 + N / 48000. The header is patched every second, so a crash leaves a readable file.
// Objective-C on purpose: it builds with the Command Line Tools' clang alone (no Xcode, no Swift toolchain match).
//
// stdout, one JSON line each: {"event":"ready"} once streaming, {"event":"t0","t0":S} on the first buffer,
// {"event":"error","message":M} on failure (then exit 2), {"event":"stopped","frames":N} at the end.
// Stops when stdin closes or receives a line, or on SIGINT/SIGTERM.
//
//   clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -framework Foundation -framework ScreenCaptureKit \
//         -framework CoreMedia -framework AudioToolbox sysaudio.m -o homacapture-sysaudio
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>
#include <signal.h>

static const double RATE = 48000.0;
static const int CH = 2;

static void emit(NSDictionary *obj) {
    NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
    if (!d) return;
    @synchronized ([NSFileHandle class]) { fwrite(d.bytes, 1, d.length, stdout); fputc('\n', stdout); fflush(stdout); }
}
static void fail(NSString *msg) { emit(@{@"event": @"error", @"message": msg}); exit(2); }

static FILE *wav; static int64_t frames = 0; static double t0 = -1; static CFAbsoluteTime lastPatch = 0;
static dispatch_queue_t q;

static void put32(uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static void put16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
static void header(void) {
    uint8_t h[44]; uint32_t bytes = (uint32_t)MIN(frames * CH * 4, (int64_t)UINT32_MAX - 36);
    memcpy(h, "RIFF", 4); put32(h + 4, 36 + bytes); memcpy(h + 8, "WAVEfmt ", 8); put32(h + 16, 16);
    put16(h + 20, 3); put16(h + 22, CH); put32(h + 24, (uint32_t)RATE); put32(h + 28, (uint32_t)RATE * CH * 4);
    put16(h + 32, CH * 4); put16(h + 34, 32); memcpy(h + 36, "data", 4); put32(h + 40, bytes);
    long end = ftell(wav); fseek(wav, 0, SEEK_SET); fwrite(h, 1, 44, wav); fseek(wav, end ? end : 44, SEEK_SET); fflush(wav);
}
static void writeFrames(const float *s, int64_t n) {
    fwrite(s, sizeof(float), (size_t)(n * CH), wav); frames += n;
    CFAbsoluteTime now = CFAbsoluteTimeGetCurrent(); if (now - lastPatch > 1) { header(); lastPatch = now; }
}
static void silence(int64_t n) {
    static float zeros[48000 * 2];
    while (n > 0) { int64_t k = MIN(n, (int64_t)48000); writeFrames(zeros, k); n -= k; }
}

@interface Cap : NSObject <SCStreamOutput, SCStreamDelegate>
@property (strong) SCStream *stream;
@end
@implementation Cap
- (void)start {
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent *content, NSError *err) {
        SCDisplay *display = content.displays.firstObject;
        if (!display) fail([@"Computer sound needs the Screen Recording permission. " stringByAppendingString:err.localizedDescription ?: @"No display found."]);
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:@[] exceptingWindows:@[]];
        SCStreamConfiguration *cfg = [SCStreamConfiguration new];
        cfg.capturesAudio = YES; cfg.sampleRate = (NSInteger)RATE; cfg.channelCount = CH; cfg.excludesCurrentProcessAudio = YES;
        cfg.width = 2; cfg.height = 2; cfg.minimumFrameInterval = CMTimeMake(1, 2); cfg.showsCursor = NO;
        self.stream = [[SCStream alloc] initWithFilter:filter configuration:cfg delegate:self];
        NSError *e = nil;
        if (![self.stream addStreamOutput:self type:SCStreamOutputTypeAudio sampleHandlerQueue:q error:&e] ||
            ![self.stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:q error:&e])   // video is required; frames are dropped
            fail([@"Could not set up computer sound: " stringByAppendingString:e.localizedDescription]);
        [self.stream startCaptureWithCompletionHandler:^(NSError *err2) {
            if (err2) fail([@"Could not start computer sound: " stringByAppendingString:err2.localizedDescription]);
            emit(@{@"event": @"ready"});
        }];
    }];
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sb ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio || !CMSampleBufferIsValid(sb)) return;
    CMItemCount n = CMSampleBufferGetNumSamples(sb); if (n <= 0) return;
    CMTime pt = CMSampleBufferGetPresentationTimeStamp(sb); if (!CMTIME_IS_NUMERIC(pt)) return;
    double pts = CMTimeGetSeconds(pt);

    size_t need = 0;
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sb, &need, NULL, 0, NULL, NULL, 0, NULL);
    AudioBufferList *abl = malloc(need); CMBlockBufferRef block = NULL;
    if (CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sb, NULL, abl, need, NULL, NULL,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &block) != noErr) { free(abl); return; }
    float *out = malloc(sizeof(float) * n * CH);
    if (abl->mNumberBuffers >= CH) {                         // planar float32: one buffer per channel
        const float *l = abl->mBuffers[0].mData, *r = abl->mBuffers[1].mData;
        for (CMItemCount i = 0; i < n; i++) { out[2 * i] = l[i]; out[2 * i + 1] = r[i]; }
    } else {
        UInt32 ch = abl->mBuffers[0].mNumberChannels; const float *p = abl->mBuffers[0].mData;
        for (CMItemCount i = 0; i < n; i++) { out[2 * i] = p[i * ch]; out[2 * i + 1] = p[i * ch + (ch > 1 ? 1 : 0)]; }
    }
    if (block) CFRelease(block); free(abl);

    if (t0 < 0) { t0 = pts; emit(@{@"event": @"t0", @"t0": @(pts)}); }
    int64_t gap = llround((pts - (t0 + frames / RATE)) * RATE), skip = 0;
    if (gap > 240) silence(gap);                             // > 5 ms missing: nothing played; keep the timeline exact
    else if (gap < -240) skip = MIN(-gap, (int64_t)n);       // overlap (clock jitter): drop what is already covered
    if (n - skip > 0) writeFrames(out + skip * CH, n - skip);
    free(out);
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    emit(@{@"event": @"error", @"message": [@"Computer sound stopped: " stringByAppendingString:error.localizedDescription]});
}
@end

static Cap *cap; static volatile int stopping = 0;
static void finish(void) {
    if (stopping) return; stopping = 1;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ exit(0); });  // never hang
    void (^done)(void) = ^{ dispatch_sync(q, ^{ header(); fclose(wav); emit(@{@"event": @"stopped", @"frames": @(frames)}); }); exit(0); };
    if (cap.stream) [cap.stream stopCaptureWithCompletionHandler:^(NSError *e) { done(); }]; else done();
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: homacapture-sysaudio <out.wav>\n"); return 64; }
        wav = fopen(argv[1], "wb+"); if (!wav) fail([NSString stringWithFormat:@"Cannot write %s", argv[1]]);
        header();
        q = dispatch_queue_create("sysaudio", DISPATCH_QUEUE_SERIAL);
        static dispatch_source_t sigs[2]; int nums[2] = {SIGINT, SIGTERM};
        for (int i = 0; i < 2; i++) {
            signal(nums[i], SIG_IGN);
            sigs[i] = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, nums[i], 0, dispatch_get_main_queue());
            dispatch_source_set_event_handler(sigs[i], ^{ finish(); }); dispatch_resume(sigs[i]);
        }
        [NSThread detachNewThreadWithBlock:^{ char line[64]; fgets(line, sizeof line, stdin); dispatch_async(dispatch_get_main_queue(), ^{ finish(); }); }];
        cap = [Cap new]; [cap start];
        dispatch_main();
    }
}
