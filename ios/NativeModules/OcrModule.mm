
#import "OcrModule.h"
#import <Vision/Vision.h>

@implementation OcrModule
RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(recognize,
                 recognizeWithPath:(NSString *)imagePath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *path = [imagePath hasPrefix:@"file://"] ? [imagePath substringFromIndex:7] : imagePath;
  NSURL *url = [NSURL fileURLWithPath:path];

  VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *r, NSError *e) {
    if (e) { reject(@"VISION_ERR", e.localizedDescription, e); return; }
    NSMutableArray *out = [NSMutableArray array];
    for (VNRecognizedTextObservation *obs in (NSArray<VNRecognizedTextObservation *> *)r.results) {
      VNRecognizedText *best = [[obs topCandidates:1] firstObject];
      if (!best) continue;
      CGRect b = obs.boundingBox; // normalized 0..1
      [out addObject:@{
        @"text": best.string ?: @"",
        @"bbox": @{@"x": @(b.origin.x), @"y": @(b.origin.y), @"w": @(b.size.width), @"h": @(b.size.height)}
      }];
    }
    resolve(out);
  }];
  req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  req.usesLanguageCorrection = YES;

  NSError *err = nil;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
  if (![handler performRequests:@[req] error:&err]) {
    reject(@"VISION_RUN_ERR", err.localizedDescription, err);
  }
}
@end
