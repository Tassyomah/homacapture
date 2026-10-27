// Microphone capture for the macOS recorder, the sibling of sysaudio.m.
//
//   homacapture-mic <out.wav> [device name]
//
// Why not ffmpeg: its avfoundation audio input drops buffers on this hardware (≈7 % alone, ≈60 % while the same
// process captures a Retina screen), so voice tracks came out short and broken. Here AVCaptureAudioDataOutput hands
// over every buffer, converted by Core Audio to 48 kHz mono float32. Sync: buffer presentation times are on the host
// clock (CLOCK_UPTIME_RAW, what narrate.py stamps everything with); the first one is printed as t0 and any gap is
// filled with zeros, so sample N is always at t0 + N / 48000. The header is patched every second (crash-safe).
// Objective-C on purpose: it builds with the Command Line Tools' clang alone.
//
// stdout, one JSON line each: {"event":"ready","device":D} once running, {"event":"t0","t0":S} on the first buffer,
// {"event":"error","message":M} on failure (then exit 2), {"event":"stopped","frames":N} at the end.
// Stops when stdin closes or receives a line, or on SIGINT/SIGTERM.
//
//   clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -framework Foundation -framework AVFoundation \
//         -framework CoreMedia -framework AudioToolbox micaudio.m -o homacapture-mic
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>
#include <signal.h>

static const double RATE = 48000.0;

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
    uint8_t h[44]; uint32_t bytes = (uint32_t)MIN(frames * 4, (int64_t)UINT32_MAX - 36);
    memcpy(h, "RIFF", 4); put32(h + 4, 36 + bytes); memcpy(h + 8, "WAVEfmt ", 8); put32(h + 16, 16);
    put16(h + 20, 3); put16(h + 22, 1); put32(h + 24, (uint32_t)RATE); put32(h + 28, (uint32_t)RATE * 4);
    put16(h + 32, 4); put16(h + 34, 32); memcpy(h + 36, "data", 4); put32(h + 40, bytes);
    long end = ftell(wav); fseek(wav, 0, SEEK_SET); fwrite(h, 1, 44, wav); fseek(wav, end ? end : 44, SEEK_SET); fflush(wav);
}
static void writeFrames(const float *s, int64_t n) {
    fwrite(s, sizeof(float), (size_t)n, wav); frames += n;
    CFAbsoluteTime now = CFAbsoluteTimeGetCurrent(); if (now - lastPatch > 1) { header(); lastPatch = now; }
}
static void silence(int64_t n) {
    static float zeros[48000];
    while (n > 0) { int64_t k = MIN(n, (int64_t)48000); writeFrames(zeros, k); n -= k; }
}

@interface Cap : NSObject <AVCaptureAudioDataOutputSampleBufferDelegate>
@property (strong) AVCaptureSession *session;
@end
@implementation Cap
- (void)startWithName:(NSString *)name {
    NSArray<AVCaptureDevice *> *devs;
    if (@available(macOS 14.0, *)) devs = [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:
        @[AVCaptureDeviceTypeMicrophone, AVCaptureDeviceTypeExternal] mediaType:AVMediaTypeAudio position:AVCaptureDevicePositionUnspecified].devices;
    else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        devs = [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio];
#pragma clang diagnostic pop
    }
    AVCaptureDevice *dev = nil;
    for (AVCaptureDevice *d in devs) if (name.length && [d.localizedName isEqualToString:name]) { dev = d; break; }
    if (!dev) dev = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
    if (!dev) fail(@"No microphone found.");
    NSError *e = nil;
    AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:dev error:&e];
    if (!input) fail([@"The microphone could not be opened. Check Microphone permission for this app. " stringByAppendingString:e.localizedDescription ?: @""]);
    AVCaptureAudioDataOutput *out = [AVCaptureAudioDataOutput new];
    out.audioSettings = @{AVFormatIDKey: @(kAudioFormatLinearPCM), AVSampleRateKey: @(RATE), AVNumberOfChannelsKey: @1,
                          AVLinearPCMBitDepthKey: @32, AVLinearPCMIsFloatKey: @YES, AVLinearPCMIsNonInterleaved: @NO,
                          AVLinearPCMIsBigEndianKey: @NO};
    [out setSampleBufferDelegate:self queue:q];
    self.session = [AVCaptureSession new];
    if (![self.session canAddInput:input] || ![self.session canAddOutput:out]) fail(@"The microphone could not be set up.");
    [self.session addInput:input]; [self.session addOutput:out];
    [[NSNotificationCenter defaultCenter] addObserverForName:AVCaptureSessionRuntimeErrorNotification object:self.session queue:nil
                                                  usingBlock:^(NSNotification *n) {
        NSError *err = n.userInfo[AVCaptureSessionErrorKey];
        emit(@{@"event": @"error", @"message": [@"The microphone stopped: " stringByAppendingString:err.localizedDescription ?: @"unknown error"]});
    }];
    [self.session startRunning];
    if (!self.session.running) fail(@"The microphone could not be started.");
    emit(@{@"event": @"ready", @"device": dev.localizedName});
}
- (void)captureOutput:(AVCaptureOutput *)o didOutputSampleBuffer:(CMSampleBufferRef)sb fromConnection:(AVCaptureConnection *)c {
    if (!CMSampleBufferIsValid(sb)) return;
    CMItemCount n = CMSampleBufferGetNumSamples(sb); if (n <= 0) return;
    CMTime pt = CMSampleBufferGetPresentationTimeStamp(sb); if (!CMTIME_IS_NUMERIC(pt)) return;
    double pts = CMTimeGetSeconds(pt);
    CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sb); if (!block) return;
    size_t len = 0; char *data = NULL;
    if (CMBlockBufferGetDataPointer(block, 0, NULL, &len, &data) != kCMBlockBufferNoErr || !data) return;
    float *buf = (float *)data; float *copy = NULL;
    if (!CMBlockBufferIsRangeContiguous(block, 0, len)) {   // rare: copy out a fragmented buffer
        len = CMBlockBufferGetDataLength(block); copy = malloc(len);
        CMBlockBufferCopyDataBytes(block, 0, len, copy); buf = copy;
    }
    n = MIN(n, (CMItemCount)(len / sizeof(float)));

    if (t0 < 0) { t0 = pts; emit(@{@"event": @"t0", @"t0": @(pts)}); }
    int64_t gap = llround((pts - (t0 + frames / RATE)) * RATE), skip = 0;
    if (gap > 240) silence(gap);                             // > 5 ms missing: keep the timeline exact
    else if (gap < -240) skip = MIN(-gap, (int64_t)n);       // overlap (clock jitter): drop what is already covered
    if (n - skip > 0) writeFrames(buf + skip, n - skip);
    free(copy);
}
@end

static Cap *cap; static volatile int stopping = 0;
static void finish(void) {
    if (stopping) return; stopping = 1;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ exit(0); });  // never hang
    [cap.session stopRunning];
    dispatch_sync(q, ^{ header(); fclose(wav); emit(@{@"event": @"stopped", @"frames": @(frames)}); });
    exit(0);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: homacapture-mic <out.wav> [device name]\n"); return 64; }
        wav = fopen(argv[1], "wb+"); if (!wav) fail([NSString stringWithFormat:@"Cannot write %s", argv[1]]);
        header();
        q = dispatch_queue_create("mic", DISPATCH_QUEUE_SERIAL);
        static dispatch_source_t sigs[2]; int nums[2] = {SIGINT, SIGTERM};
        for (int i = 0; i < 2; i++) {
            signal(nums[i], SIG_IGN);
            sigs[i] = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, nums[i], 0, dispatch_get_main_queue());
            dispatch_source_set_event_handler(sigs[i], ^{ finish(); }); dispatch_resume(sigs[i]);
        }
        [NSThread detachNewThreadWithBlock:^{ char line[64]; fgets(line, sizeof line, stdin); dispatch_async(dispatch_get_main_queue(), ^{ finish(); }); }];
        cap = [Cap new]; [cap startWithName:argc > 2 ? [NSString stringWithUTF8String:argv[2]] : @""];
        dispatch_main();
    }
}
