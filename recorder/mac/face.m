// Where the speaker is in an imported video, for punch-in zooms and vertical crops (macOS Vision).
//
//   homacapture-face <video> [samples]
//
// Samples frames evenly across the video, finds the largest face in each, and prints one JSON line:
// {"event":"face","x":X,"y":Y,"w":W,"h":H,"found":N,"samples":S} in video pixels (top-left origin; x,y = face centre,
// median over the frames where a face was found), or {"event":"face","found":0,...} when there is none.
// Objective-C on purpose: it builds with the Command Line Tools' clang alone.
//
//   clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -framework Foundation -framework AVFoundation -framework CoreMedia \
//         -framework Vision -framework CoreGraphics face.m -o homacapture-face
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <Vision/Vision.h>

static double median(NSMutableArray<NSNumber *> *a) {
    if (!a.count) return 0;
    [a sortUsingSelector:@selector(compare:)];
    return a[a.count / 2].doubleValue;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: homacapture-face <video> [samples]\n"); return 64; }
        int samples = argc > 2 ? MAX(3, atoi(argv[2])) : 12;
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]] options:nil];
        AVAssetImageGenerator *gen = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
        gen.appliesPreferredTrackTransform = YES;
        gen.maximumSize = CGSizeMake(960, 960);
        gen.requestedTimeToleranceBefore = CMTimeMake(1, 2); gen.requestedTimeToleranceAfter = CMTimeMake(1, 2);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        double dur = CMTimeGetSeconds(asset.duration);
        AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
#pragma clang diagnostic pop
        if (!track || !(dur > 0)) { printf("{\"event\":\"error\",\"message\":\"no video track\"}\n"); return 2; }
        CGSize nat = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform);
        double W = fabs(nat.width), H = fabs(nat.height);
        NSMutableArray<NSNumber *> *xs = [NSMutableArray new], *ys = [NSMutableArray new], *ws = [NSMutableArray new], *hs = [NSMutableArray new];
        for (int i = 0; i < samples; i++) {
            CMTime t = CMTimeMakeWithSeconds(dur * (i + 0.5) / samples, 600);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            CGImageRef img = [gen copyCGImageAtTime:t actualTime:NULL error:nil];
#pragma clang diagnostic pop
            if (!img) continue;
            VNDetectFaceRectanglesRequest *req = [VNDetectFaceRectanglesRequest new];
            VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:img options:@{}];
            [h performRequests:@[req] error:nil];
            CGImageRelease(img);
            VNFaceObservation *best = nil;
            for (VNFaceObservation *f in req.results) if (!best || f.boundingBox.size.width * f.boundingBox.size.height > best.boundingBox.size.width * best.boundingBox.size.height) best = f;
            if (!best) continue;
            CGRect b = best.boundingBox;                        // normalised, bottom-left origin
            [xs addObject:@((b.origin.x + b.size.width / 2) * W)];
            [ys addObject:@((1 - (b.origin.y + b.size.height / 2)) * H)];
            [ws addObject:@(b.size.width * W)]; [hs addObject:@(b.size.height * H)];
        }
        printf("{\"event\":\"face\",\"x\":%.1f,\"y\":%.1f,\"w\":%.1f,\"h\":%.1f,\"found\":%lu,\"samples\":%d,\"width\":%.0f,\"height\":%.0f}\n",
               median(xs), median(ys), median(ws), median(hs), (unsigned long)xs.count, samples, W, H);
        return 0;
    }
}
