// Cuts the speaker out of a video for "Remove / blur background" (macOS Vision person segmentation).
//
//   ffmpeg … -f rawvideo -pix_fmt bgra - | homacapture-matte <width> <height> [fast|balanced] | ffmpeg -f rawvideo -pix_fmt bgra …
//
// Reads raw BGRA frames of width×height from stdin and writes the same frames to stdout with the alpha channel set to
// the person mask (straight alpha), so the encoder on the other end makes a transparent video of just the speaker.
// The mask is smoothed against the previous frame to keep edges from flickering. Progress goes to stderr as JSON lines:
// {"event":"frame","n":N} every 15 frames, then {"event":"done","frames":N}.
// Objective-C on purpose: it builds with the Command Line Tools' clang alone.
//
//   clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -framework Foundation -framework Vision -framework CoreVideo matte.m -o homacapture-matte
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>

static int readAll(uint8_t *buf, size_t n) {
    size_t got = 0;
    while (got < n) { size_t r = fread(buf + got, 1, n - got, stdin); if (r == 0) return got == 0 ? 0 : -1; got += r; }
    return 1;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) { fprintf(stderr, "usage: homacapture-matte <width> <height> [fast|balanced]\n"); return 64; }
        const int W = atoi(argv[1]), H = atoi(argv[2]);
        if (W <= 0 || H <= 0) return 64;
        BOOL fast = argc > 3 && strcmp(argv[3], "fast") == 0;
        const size_t stride = (size_t)W * 4, size = stride * H;
        uint8_t *frame = malloc(size);
        float *prev = NULL;                                   // last mask at output size, for temporal smoothing
        VNSequenceRequestHandler *seq = [VNSequenceRequestHandler new];
        VNGeneratePersonSegmentationRequest *req = [VNGeneratePersonSegmentationRequest new];
        req.qualityLevel = fast ? VNGeneratePersonSegmentationRequestQualityLevelFast : VNGeneratePersonSegmentationRequestQualityLevelBalanced;
        req.outputPixelFormat = kCVPixelFormatType_OneComponent8;
        long n = 0;
        int st;
        while ((st = readAll(frame, size)) == 1) {
            @autoreleasepool {
                CVPixelBufferRef pb = NULL;
                CVPixelBufferCreateWithBytes(kCFAllocatorDefault, W, H, kCVPixelFormatType_32BGRA, frame, stride, NULL, NULL, NULL, &pb);
                NSError *err = nil;
                BOOL ok = pb && [seq performRequests:@[req] onCVPixelBuffer:pb error:&err];
                if (pb) CVPixelBufferRelease(pb);
                CVPixelBufferRef m = ok ? req.results.firstObject.pixelBuffer : NULL;
                if (!prev) { prev = malloc(sizeof(float) * W * H); for (long i = 0; i < (long)W * H; i++) prev[i] = 1; }
                if (m) {
                    CVPixelBufferLockBaseAddress(m, kCVPixelBufferLock_ReadOnly);
                    const int mw = (int)CVPixelBufferGetWidth(m), mh = (int)CVPixelBufferGetHeight(m);
                    const size_t ms = CVPixelBufferGetBytesPerRow(m);
                    const uint8_t *mb = CVPixelBufferGetBaseAddress(m);
                    // bilinear upscale of the mask to the frame, blended 65/35 with the previous frame's mask
                    for (int y = 0; y < H; y++) {
                        float fy = ((y + 0.5f) * mh / H) - 0.5f; int y0 = fy < 0 ? 0 : (int)fy; int y1 = y0 + 1 < mh ? y0 + 1 : y0; float wy = fy - y0; if (wy < 0) wy = 0;
                        for (int x = 0; x < W; x++) {
                            float fx = ((x + 0.5f) * mw / W) - 0.5f; int x0 = fx < 0 ? 0 : (int)fx; int x1 = x0 + 1 < mw ? x0 + 1 : x0; float wx = fx - x0; if (wx < 0) wx = 0;
                            float a = mb[y0 * ms + x0] * (1 - wx) + mb[y0 * ms + x1] * wx;
                            float b = mb[y1 * ms + x0] * (1 - wx) + mb[y1 * ms + x1] * wx;
                            float v = (a * (1 - wy) + b * wy) / 255.f;
                            long i = (long)y * W + x;
                            prev[i] = n == 0 ? v : prev[i] * 0.35f + v * 0.65f;
                        }
                    }
                    CVPixelBufferUnlockBaseAddress(m, kCVPixelBufferLock_ReadOnly);
                }
                for (long i = 0; i < (long)W * H; i++) {
                    float v = prev[i];
                    v = (v - 0.08f) / 0.84f;                          // firm up the soft fringe a little
                    frame[i * 4 + 3] = (uint8_t)(v <= 0 ? 0 : v >= 1 ? 255 : v * 255);
                }
                if (fwrite(frame, 1, size, stdout) != size) { fprintf(stderr, "{\"event\":\"error\",\"message\":\"output closed\"}\n"); return 2; }
                n++;
                if (n % 15 == 0) { fprintf(stderr, "{\"event\":\"frame\",\"n\":%ld}\n", n); fflush(stderr); }
            }
        }
        fflush(stdout);
        fprintf(stderr, "{\"event\":\"done\",\"frames\":%ld}\n", n);
        return st < 0 ? 3 : 0;
    }
}
